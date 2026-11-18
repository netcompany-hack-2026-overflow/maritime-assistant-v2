import type { Prisma } from "@prisma/client";
import {
  formatUtc,
  nearestPointOnRoute,
  planBunkerOptions,
  screenedOutCalc,
  splitRouteAt,
  type BunkerDelaySource,
  type BunkerPlan,
  type BunkerPlanInput,
  type BunkerScreen,
  type OfferTerms,
  type PortEventExtraction,
} from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getSettings } from "../lib/settings.js";
import { mailEnv } from "../lib/env.js";
import { getLlmProvider } from "../llm/index.js";
import { voyageProgressNow } from "./voyagePosition.js";
import { crossesLand } from "./land.js";
import { syncBunkerDrafts } from "./bunkerDrafts.js";
import { computeScenarios, rationaleFor, voyageInclude, type VoyageForScenarios } from "./scenarios.js";
import { recommendationFields } from "./scenarioFields.js";

type VoyageWithPorts = Prisma.VoyageGetPayload<{ include: { vessel: true; originPort: true; destPort: true } }>;
type PortRow = { id: string; name: string; lat: number; lon: number };

/** Offers further off a ship's remaining route than this aren't matched to it. */
const BUNKER_MATCH_MAX_OFF_ROUTE_NM = 500;

/** Congestion or closure reported at the bunker port within this window counts as a likely delay. */
const PORT_CONDITION_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * Pick the voyage a bunker offer is for: the ship its IMO number or name
 * points to, otherwise the underway ship whose remaining route passes closest
 * to the supply port.
 */
function matchBunkerVoyage(candidates: VoyageWithPorts[], port: PortRow, vesselName: string | null, vesselImo: string | null) {
  const byImo = vesselImo ? candidates.find((c) => c.vessel.imo === vesselImo) : undefined;
  if (byImo) return byImo;
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

/** The offer's commercial terms as stored on the port event. */
function offerTermsFrom(extraction: PortEventExtraction, receivedAt: Date): OfferTerms {
  const minutes = extraction.quoteValidityMinutes ?? null;
  return {
    vesselImo: extraction.vesselImo ?? null,
    vesselEta: extraction.vesselEta ?? null,
    bargingType: extraction.bargingType ?? null,
    bargingUsd: extraction.bargingUsd ?? null,
    otherFeesUsd: extraction.otherFeesUsd ?? null,
    paymentTerms: extraction.paymentTerms ?? null,
    paymentDays: extraction.paymentDays ?? null,
    deliveryDelayHours: extraction.deliveryDelayHours ?? null,
    deliveryEarliest: extraction.deliveryEarliest ?? null,
    quoteValidityMinutes: minutes,
    quoteFirmUntil: minutes !== null ? new Date(receivedAt.getTime() + minutes * 60_000).toISOString() : null,
    lines: extraction.offerLines ?? [],
  };
}

/**
 * Why the ship might wait at the bunker port: the supplier's own delivery
 * window, and congestion/closure recently reported for that port.
 */
async function bunkerPortDelays(
  port: PortRow,
  terms: OfferTerms | null,
  etaAtPortAtCurrentSpeed: Date,
  now: Date
): Promise<BunkerDelaySource[]> {
  const delays: BunkerDelaySource[] = [];
  if (terms?.deliveryDelayHours) {
    delays.push({
      source: "SUPPLIER_WINDOW",
      hours: terms.deliveryDelayHours,
      note: `barge alongside ${terms.deliveryDelayHours} h after arrival (supplier's window)`,
    });
  }
  if (terms?.deliveryEarliest) {
    const hours = (new Date(terms.deliveryEarliest).getTime() - etaAtPortAtCurrentSpeed.getTime()) / 3_600_000;
    if (hours > 0) {
      delays.push({
        source: "SUPPLIER_WINDOW",
        hours,
        note: `earliest delivery ${formatUtc(terms.deliveryEarliest)}, ${hours.toFixed(1)} h after the ship gets there`,
      });
    }
  }
  const reported = await prisma.portEvent.findMany({
    where: {
      portId: port.id,
      eventType: { in: ["CONGESTION", "CLOSURE"] },
      delayHours: { not: null },
      createdAt: { gte: new Date(now.getTime() - PORT_CONDITION_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const latest = reported[0];
  if (latest?.delayHours) {
    delays.push({
      source: latest.eventType === "CLOSURE" ? "PORT_CLOSURE" : "PORT_CONGESTION",
      hours: latest.delayHours,
      note: `${port.name} ${latest.eventType === "CLOSURE" ? "closure" : "congestion"} reported: +${latest.delayHours} h`,
    });
  }
  return delays;
}

/** Plain words for an offer the time check stopped; written without a model call. */
function screenedOutRationale(screen: BunkerScreen, vesselName: string, portName: string, destPortName: string): string {
  if (screen.stoppedBecause === "EXPIRED") {
    return (
      `Not analysed further: even at full speed ${vesselName} would reach ${portName} ` +
      `${formatUtc(screen.earliestEtaAtBunker)}, after the offer expires (${formatUtc(screen.validUntil!)}).`
    );
  }
  const parts = [`${screen.bunkeringHours.toFixed(1)} h alongside`];
  if (screen.delayHours > 0) parts.push(`${screen.delayHours.toFixed(1)} h waiting for the barge`);
  parts.push(`${screen.detourHours.toFixed(1)} h detour`);
  return (
    `Not analysed further: calling at ${portName} needs about ${screen.neededHours.toFixed(1)} h ` +
    `(${parts.join(" + ")}), but ${vesselName} has only ${Math.max(0, screen.slackHours).toFixed(1)} h to spare ` +
    `before its ${destPortName} berth (tolerance ${Math.round(screen.toleranceHours * 60)} min).`
  );
}

async function createBunkerRecommendation(
  voyage: VoyageWithPorts,
  portEvent: {
    id: string;
    port: PortRow & { unlocode?: string };
    fuelGrade: string | null;
    priceUsdPerT: number | null;
    qtyMinT: number | null;
    qtyMaxT: number | null;
    validUntil: Date | null;
    supplier: string | null;
    offerTerms: unknown;
  },
  email: { fromAddr: string; subject: string }
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
  const terms = (portEvent.offerTerms as OfferTerms | null) ?? null;
  const etaAtCurrentSpeed = new Date(now.getTime() + ((nearest.alongNm + nearest.offRouteNm) / voyage.speedKn) * 3_600_000);
  const input: BunkerPlanInput = {
    now: now.toISOString(),
    deadline: deadline.toISOString(),
    remainingNm,
    offRouteNm: nearest.offRouteNm,
    alongNm: nearest.alongNm,
    shipPosition: ahead[0],
    turnOff: nearest.point,
    bunkerPort: { lat: port.lat, lon: port.lon },
    destination: { lat: voyage.destPort.lat, lon: voyage.destPort.lon },
    vessel: {
      speedKn: voyage.speedKn,
      designSpeedKn: voyage.vessel.designSpeedKn,
      minSpeedKn: voyage.vessel.minSpeedKn,
      fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
      auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    },
    offer: {
      priceUsdPerT: portEvent.priceUsdPerT,
      qtyMinT: portEvent.qtyMinT,
      qtyMaxT: portEvent.qtyMaxT,
      validUntil: portEvent.validUntil ? portEvent.validUntil.toISOString() : null,
    },
    stemQtyT: settings.bunkerDefaultQtyT,
    refPriceEurPerT: settings.fuelPriceEurPerT,
    usdEurRate: settings.usdEurRate,
    stdPortHours: settings.bunkerPortHours,
    stdQtyT: settings.bunkerDefaultQtyT,
    pumpRateTPerH: settings.bunkerPumpRateTPerH,
    portFeeEur: settings.bunkerPortFeeEur,
    co2Factor: settings.co2Factor,
    delays: await bunkerPortDelays(port, terms, etaAtCurrentSpeed, now),
    toleranceHours: settings.bunkerSlackToleranceMin / 60,
  };

  // Cheap time check first; options (and the model call) only for offers that pass.
  const { screen, options } = planBunkerOptions(input);
  const plan: BunkerPlan = {
    version: 1,
    input,
    screen,
    options,
    route: splitRouteAt(ahead, nearest.alongNm),
    context: {
      supplierName: portEvent.supplier,
      supplierAddr: email.fromAddr,
      offerSubject: email.subject,
      vesselName: voyage.vessel.name,
      vesselImo: voyage.vessel.imo,
      portName: port.name,
      portUnlocode: port.unlocode ?? "",
      fuelGrade: portEvent.fuelGrade,
      priceUsdPerT: portEvent.priceUsdPerT,
      validUntil: input.offer.validUntil,
      senderName: mailEnv.fromName,
    },
  };
  const calc = options[0]?.calc ?? screenedOutCalc(input);

  const rationale = !screen.passed
    ? screenedOutRationale(screen, voyage.vessel.name, port.name, voyage.destPort.name)
    : await getLlmProvider().explainRecommendation({
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

  // Every offer waits for a human, worth it or not; the card says which, and why.
  const recommendation = await prisma.recommendation.create({
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
      bunkerPlan: plan as unknown as Prisma.InputJsonValue,
      rationale,
      status: "PENDING",
    },
  });
  await syncBunkerDrafts(prisma, recommendation.id, plan);
  return recommendation;
}

async function createRecommendationForPortEvent(
  voyage: VoyageForScenarios,
  portEvent: { id: string; eventType: string; delayHours: number | null; newBerthTime: Date | null }
) {
  if (portEvent.delayHours === null) return null;
  // Notices often give only "delayed by N hours". In that case the new berth
  // time is the voyage's current planned arrival pushed back by the delay.
  const newBerthTime =
    portEvent.newBerthTime ??
    new Date(voyage.plannedEta.getTime() + portEvent.delayHours * 3_600_000);

  const result = await computeScenarios(voyage, newBerthTime);
  if (!result) return null;
  const { set, calc } = result;
  // Nothing beats carrying on as planned: no action to recommend.
  if (set.recommendedId === "A") return null;
  const fields = recommendationFields(set);
  if (fields.fuelSavedT <= 0 && fields.etsSavedEur <= 0) return null;

  const rationale = await rationaleFor(voyage, portEvent, set);

  return prisma.recommendation.create({
    data: {
      voyageId: voyage.id,
      portEventId: portEvent.id,
      actionType: "ADJUST_SPEED",
      currentSpeedKn: voyage.speedKn,
      ...fields,
      calc: calc as unknown as Prisma.InputJsonValue,
      scenarios: set as unknown as Prisma.InputJsonValue,
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

  let matchedVoyage: VoyageForScenarios | null = null;

  if (port && extraction.eventType === "BUNKER_OFFER") {
    const candidates = await prisma.voyage.findMany({
      where: { status: "UNDERWAY" },
      include: voyageInclude,
    });
    matchedVoyage = matchBunkerVoyage(candidates, port, extraction.vesselNameMentioned, extraction.vesselImo ?? null) as VoyageForScenarios | null;
  } else if (port && extraction.eventType !== "NONE") {
    const candidates = await prisma.voyage.findMany({
      where: { destPortId: port.id, status: "UNDERWAY" },
      include: voyageInclude,
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
      ...(extraction.eventType === "BUNKER_OFFER"
        ? { offerTerms: offerTermsFrom(extraction, email.receivedAt) as unknown as Prisma.InputJsonValue }
        : {}),
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
      ? portEvent.port
        ? await createBunkerRecommendation(matchedVoyage, { ...portEvent, port: portEvent.port }, email)
        : null
      : await createRecommendationForPortEvent(matchedVoyage, portEvent);

  return { portEvent, matchedVoyage, recommendation, alreadyProcessed: false };
}
