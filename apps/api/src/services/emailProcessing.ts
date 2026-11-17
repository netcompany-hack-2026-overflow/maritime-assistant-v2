import type { Prisma } from "@prisma/client";
import { calculateJit } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { getLlmProvider } from "../llm/index.js";
import { mockWeatherFor } from "../sim/weather.js";

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
    fuelPriceEurPerT: env.fuelPriceEurPerT,
    co2Factor: env.co2Factor,
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

  if (port && extraction.eventType !== "NONE") {
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
      rawExtraction: extraction as unknown as Prisma.InputJsonValue,
      sourceSpans: extraction.sourceSpans as unknown as Prisma.InputJsonValue,
      confidence: extraction.confidence,
    },
    include: { port: true },
  });

  await prisma.email.update({ where: { id: email.id }, data: { processed: true } });

  const recommendation = matchedVoyage
    ? await createRecommendationForPortEvent(matchedVoyage, portEvent)
    : null;

  return { portEvent, matchedVoyage, recommendation, alreadyProcessed: false };
}
