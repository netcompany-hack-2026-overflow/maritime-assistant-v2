import type { Prisma } from "@prisma/client";
import { calculateBunker, calculateJit, nearestPointOnRoute, type BunkerCalc } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getSettings } from "../lib/settings.js";
import { getLlmProvider } from "../llm/index.js";
import { mockWeatherFor } from "../sim/weather.js";
import { voyageProgressNow } from "./voyagePosition.js";
import { crossesLand } from "./land.js";

type VoyageWithPorts = Prisma.VoyageGetPayload<{ include: { vessel: true; originPort: true; destPort: true } }>;
type PortRow = { id: string; name: string; lat: number; lon: number };

/** Offers further off a ship's remaining route than this aren't matched to it. */
const BUNKER_MATCH_MAX_OFF_ROUTE_NM = 500;

const eurK = (v: number) => `€${Math.round(Math.abs(v) / 1000).toLocaleString("en-US")}k`;

/** Plain-English reason a bunker offer was turned down, e.g. for the Ask page. */
export function bunkerRejectReason(calc: BunkerCalc, destPortName: string): string {
  const parts: string[] = [];
  if (calc.reasons.includes("NEGATIVE_NET")) {
    parts.push(`the detour costs ${eurK(calc.netEur)} more than the cheaper fuel saves`);
  }
  if (calc.reasons.includes("LATE")) {
    parts.push(`the ship would miss the ${destPortName} berth by ${calc.lateHours.toFixed(0)} h even at full speed`);
  }
  if (calc.reasons.includes("EXPIRED")) parts.push("the offer expires before the ship gets there");
  return `Not worth it: ${joinAnd(parts)}.`;
}

/** ["a", "b", "c"] -> "a, b and c" */
export function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Pick the voyage a bunker offer is for: the ship it names, otherwise the
 * underway ship whose remaining route passes closest to the supply port.
 */
function matchBunkerVoyage(candidates: VoyageWithPorts[], port: PortRow, vesselName: string | null) {
  const named = vesselName
    ? candidates.find((c) => c.vessel.name.toLowerCase() === vesselName.toLowerCase())
    : undefined;
  if (named) return named;
  let best: { voyage: VoyageWithPorts; offRouteNm: number } | null = null;
  for (const voyage of candidates) {
    const { remainingNm, ahead } = voyageProgressNow(voyage);
    if (remainingNm <= 0) continue;
    const nearest = nearestPointOnRoute(ahead, port, crossesLand);
    if (!nearest) continue;
    const { offRouteNm } = nearest;
    if (offRouteNm <= BUNKER_MATCH_MAX_OFF_ROUTE_NM && (!best || offRouteNm < best.offRouteNm)) {
      best = { voyage, offRouteNm };
    }
  }
  return best?.voyage ?? null;
}

async function createBunkerRecommendation(
  voyage: VoyageWithPorts,
  portEvent: {
    id: string;
    port: PortRow | null;
    fuelGrade: string | null;
    priceUsdPerT: number | null;
    qtyMinT: number | null;
    qtyMaxT: number | null;
    validUntil: Date | null;
  }
) {
  const port = portEvent.port;
  if (!port || portEvent.priceUsdPerT === null) return null;

  const now = new Date();
  const { remainingNm, ahead } = voyageProgressNow(voyage, now);
  if (remainingNm <= 0) return null;
  // Straight out-and-back from the closest point on the route with open water to the port.
  const nearest = nearestPointOnRoute(ahead, port, crossesLand);
  if (!nearest) return null;

  // The berth the ship must still make: the agreed berth time, else the latest
  // reported one (a delay not yet acted on still gives slack), else the plan.
  const latestBerthEvent = await prisma.portEvent.findFirst({
    where: { voyageId: voyage.id, newBerthTime: { not: null }, eventType: { not: "BUNKER_OFFER" } },
    orderBy: { createdAt: "desc" },
  });
  const deadline = voyage.berthTime ?? latestBerthEvent?.newBerthTime ?? voyage.plannedEta;

  const settings = await getSettings();
  const calc = calculateBunker({
    remainingNm,
    offRouteNm: nearest.offRouteNm,
    alongNm: nearest.alongNm,
    speedKn: voyage.speedKn,
    designSpeedKn: voyage.vessel.designSpeedKn,
    fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
    auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    now,
    deadline,
    offer: {
      priceUsdPerT: portEvent.priceUsdPerT,
      qtyMinT: portEvent.qtyMinT,
      qtyMaxT: portEvent.qtyMaxT,
      validUntil: portEvent.validUntil,
    },
    refPriceEurPerT: settings.fuelPriceEurPerT,
    usdEurRate: settings.usdEurRate,
    portHours: settings.bunkerPortHours,
    portFeeEur: settings.bunkerPortFeeEur,
    defaultQtyT: settings.bunkerDefaultQtyT,
    co2Factor: settings.co2Factor,
  });

  const rationale = await getLlmProvider().explainRecommendation({
    vesselName: voyage.vessel.name,
    originPortName: voyage.originPort.name,
    destPortName: voyage.destPort.name,
    portEventType: "BUNKER_OFFER",
    portName: port.name,
    delayHours: 0,
    currentSpeedKn: voyage.speedKn,
    recommendedSpeedKn: calc.speedBunkerKn,
    fuelSavedT: -calc.extraFuelT,
    costSavedEur: calc.netEur,
    co2SavedT: -calc.extraCo2T,
    bunker: {
      bunkerPortName: port.name,
      fuelGrade: portEvent.fuelGrade,
      priceUsdPerT: portEvent.priceUsdPerT,
      qtyT: calc.qtyT,
      detourNm: calc.detourNm,
      extraHours: calc.extraHours,
      extraFuelT: calc.extraFuelT,
      priceSavingEur: calc.priceSavingEur,
      netEur: calc.netEur,
      stillMakesBerth: calc.arrivalOk,
      offerValidAtArrival: calc.offerValidAtArrival,
      verdict: calc.verdict,
    },
  });

  const worthIt = calc.verdict === "WORTH_IT";
  const rejectReason = worthIt ? null : bunkerRejectReason(calc, voyage.destPort.name);

  return prisma.$transaction(async (tx) => {
    const rec = await tx.recommendation.create({
      data: {
        voyageId: voyage.id,
        portEventId: portEvent.id,
        actionType: "BUNKER_DETOUR",
        currentSpeedKn: voyage.speedKn,
        recommendedSpeedKn: calc.speedBunkerKn,
        // Negative: the detour burns extra fuel. The € figure is the net result.
        fuelSavedT: -calc.extraFuelT,
        costSavedEur: calc.netEur,
        co2SavedT: -calc.extraCo2T,
        calc: calc as unknown as Prisma.InputJsonValue,
        rationale,
        // Not-worth-it offers are recorded, already declined, so "why didn't we
        // take it?" has an answer. They never wait for a human.
        status: worthIt ? "PENDING" : "REJECTED",
        rejectReason,
        decidedAt: worthIt ? null : now,
      },
    });
    if (!worthIt) {
      await tx.auditLog.create({
        data: {
          entity: "recommendation",
          entityId: rec.id,
          action: "AUTO_REJECTED",
          payload: { reasons: calc.reasons, netEur: calc.netEur, reason: rejectReason },
        },
      });
    }
    return rec;
  });
}

async function createRecommendationForPortEvent(
  voyage: Prisma.VoyageGetPayload<{ include: { vessel: true; originPort: true; destPort: true } }>,
  portEvent: { id: string; eventType: string; delayHours: number | null; newBerthTime: Date | null }
) {
  if (portEvent.delayHours === null) return null;
  // Notices often give only "delayed by N hours". In that case the new berth
  // time is the voyage's current planned arrival pushed back by the delay.
  const newBerthTime =
    portEvent.newBerthTime ??
    new Date(voyage.plannedEta.getTime() + portEvent.delayHours * 3_600_000);

  const now = new Date();
  const distanceNm = Math.max(
    0,
    (voyage.speedKn * (voyage.plannedEta.getTime() - now.getTime())) / 3_600_000
  );
  if (distanceNm <= 0) return null;

  const settings = await getSettings();
  const calc = calculateJit({
    distanceNm,
    currentSpeedKn: voyage.speedKn,
    currentEta: voyage.plannedEta,
    newBerthTime,
    now,
    designSpeedKn: voyage.vessel.designSpeedKn,
    fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
    minSpeedKn: voyage.vessel.minSpeedKn,
    auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    fuelPriceEurPerT: settings.fuelPriceEurPerT,
    co2Factor: settings.co2Factor,
    weather: mockWeatherFor(voyage.destPort.unlocode, newBerthTime),
  });

  if (calc.fuelSavedT <= 0) return null;

  const rationale = await getLlmProvider().explainRecommendation({
    vesselName: voyage.vessel.name,
    originPortName: voyage.originPort.name,
    destPortName: voyage.destPort.name,
    portEventType: portEvent.eventType,
    portName: voyage.destPort.name,
    delayHours: portEvent.delayHours,
    currentSpeedKn: voyage.speedKn,
    recommendedSpeedKn: calc.v1,
    fuelSavedT: calc.fuelSavedT,
    costSavedEur: calc.costSavedEur,
    co2SavedT: calc.co2SavedT,
  });

  return prisma.recommendation.create({
    data: {
      voyageId: voyage.id,
      portEventId: portEvent.id,
      actionType: "ADJUST_SPEED",
      currentSpeedKn: voyage.speedKn,
      recommendedSpeedKn: calc.v1,
      fuelSavedT: calc.fuelSavedT,
      costSavedEur: calc.costSavedEur,
      co2SavedT: calc.co2SavedT,
      calc: calc as unknown as Prisma.InputJsonValue,
      rationale,
      status: "PENDING",
    },
  });
}

export async function processEmail(emailId: string) {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) {
    const err = new Error("Email not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  if (email.processed) {
    const existing = await prisma.portEvent.findFirst({
      where: { emailId: email.id },
      orderBy: { createdAt: "desc" },
      include: {
        port: true,
        voyage: { include: { vessel: true, originPort: true, destPort: true } },
      },
    });
    const recommendation = existing
      ? await prisma.recommendation.findFirst({ where: { portEventId: existing.id } })
      : null;
    return {
      portEvent: existing,
      matchedVoyage: existing?.voyage ?? null,
      recommendation,
      alreadyProcessed: true,
    };
  }

  const combinedText = `${email.subject}\n\n${email.body}`;
  const extraction = await getLlmProvider().extractEmail(combinedText);

  let port: Awaited<ReturnType<typeof prisma.port.findFirst>> = null;
  if (extraction.portUnlocode) {
    port = await prisma.port.findUnique({ where: { unlocode: extraction.portUnlocode } });
  }
  if (!port && extraction.portName) {
    port = await prisma.port.findFirst({
      where: { name: { equals: extraction.portName, mode: "insensitive" } },
    });
  }

  let matchedVoyage: Prisma.VoyageGetPayload<{
    include: { vessel: true; originPort: true; destPort: true };
  }> | null = null;

  if (port && extraction.eventType === "BUNKER_OFFER") {
    const candidates = await prisma.voyage.findMany({
      where: { status: "UNDERWAY" },
      include: { vessel: true, originPort: true, destPort: true },
    });
    matchedVoyage = matchBunkerVoyage(candidates, port, extraction.vesselNameMentioned);
  } else if (port && extraction.eventType !== "NONE") {
    const candidates = await prisma.voyage.findMany({
      where: { destPortId: port.id, status: "UNDERWAY" },
      include: { vessel: true, originPort: true, destPort: true },
    });
    if (candidates.length === 1) {
      matchedVoyage = candidates[0];
    } else if (candidates.length > 1) {
      matchedVoyage =
        (extraction.vesselNameMentioned &&
          candidates.find(
            (c) => c.vessel.name.toLowerCase() === extraction.vesselNameMentioned!.toLowerCase()
          )) ||
        candidates[0];
    }
  }

  const portEvent = await prisma.portEvent.create({
    data: {
      emailId: email.id,
      portId: port?.id ?? null,
      voyageId: matchedVoyage?.id ?? null,
      eventType: extraction.eventType,
      delayHours: extraction.delayHours,
      newBerthTime: extraction.newBerthTime
        ? new Date(extraction.newBerthTime)
        : matchedVoyage && extraction.delayHours !== null
          ? // no explicit time in the text: current planned arrival + reported delay
            new Date(matchedVoyage.plannedEta.getTime() + extraction.delayHours * 3_600_000)
          : null,
      fuelGrade: extraction.fuelGrade ?? null,
      priceUsdPerT: extraction.priceUsdPerT ?? null,
      qtyMinT: extraction.qtyMinT ?? null,
      qtyMaxT: extraction.qtyMaxT ?? null,
      validUntil: extraction.validUntil ? new Date(extraction.validUntil) : null,
      supplier: extraction.supplier ?? null,
      rawExtraction: extraction as unknown as Prisma.InputJsonValue,
      sourceSpans: extraction.sourceSpans as unknown as Prisma.InputJsonValue,
      confidence: extraction.confidence,
    },
    include: { port: true },
  });

  await prisma.email.update({ where: { id: email.id }, data: { processed: true } });

  const recommendation = !matchedVoyage
    ? null
    : portEvent.eventType === "BUNKER_OFFER"
      ? await createBunkerRecommendation(matchedVoyage, portEvent)
      : await createRecommendationForPortEvent(matchedVoyage, portEvent);

  return { portEvent, matchedVoyage, recommendation, alreadyProcessed: false };
}
