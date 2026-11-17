import { prisma } from "../lib/prisma.js";
import { simHoursSince } from "../sim/positions.js";
import { env } from "../lib/env.js";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function approveRecommendation(id: string) {
  const recommendation = await prisma.recommendation.findUnique({ where: { id } });
  if (!recommendation) throw new HttpError(404, "Recommendation not found");
  if (recommendation.status !== "PENDING") {
    throw new HttpError(409, `Recommendation is already ${recommendation.status.toLowerCase()}`);
  }

  const voyage = await prisma.voyage.findUnique({ where: { id: recommendation.voyageId } });
  if (!voyage) throw new HttpError(404, "Voyage not found");
  if (voyage.status !== "UNDERWAY") {
    throw new HttpError(409, "Voyage is no longer underway");
  }

  const portEvent = await prisma.portEvent.findUnique({ where: { id: recommendation.portEventId } });
  if (!portEvent?.newBerthTime) throw new HttpError(409, "Port event has no berth time to target");

  const now = new Date();

  // Rebase the visual position tracker at the OLD speed before switching speeds,
  // so the ship's rendered position does not jump.
  const visualSailedNm =
    voyage.sailedNmAtRebase + simHoursSince(voyage.rebasedAt, env.simSpeed, now) * voyage.speedKn;

  // Remaining distance on the real (non-accelerated) operational timeline,
  // derived from the voyage's current plannedEta and speed.
  const remainingNm = Math.max(
    0,
    (voyage.speedKn * (voyage.plannedEta.getTime() - now.getTime())) / 3_600_000
  );
  const newSpeedKn = recommendation.recommendedSpeedKn;
  const remainingHoursAtNewSpeed = newSpeedKn > 0 ? remainingNm / newSpeedKn : 0;
  const newPlannedEta = new Date(now.getTime() + remainingHoursAtNewSpeed * 3_600_000);

  const [updatedVoyage] = await prisma.$transaction([
    prisma.voyage.update({
      where: { id: voyage.id },
      data: {
        speedKn: newSpeedKn,
        sailedNmAtRebase: visualSailedNm,
        rebasedAt: now,
        plannedEta: newPlannedEta,
        berthTime: portEvent.newBerthTime,
      },
    }),
    prisma.recommendation.update({
      where: { id },
      data: { status: "APPROVED", decidedAt: now },
    }),
    prisma.auditLog.create({
      data: {
        entity: "recommendation",
        entityId: id,
        action: "APPROVED",
        payload: {
          voyageId: voyage.id,
          previousSpeedKn: voyage.speedKn,
          newSpeedKn,
          newPlannedEta: newPlannedEta.toISOString(),
          berthTime: portEvent.newBerthTime.toISOString(),
        },
      },
    }),
  ]);

  return { voyage: updatedVoyage };
}

export async function rejectRecommendation(id: string, reason: string) {
  const recommendation = await prisma.recommendation.findUnique({ where: { id } });
  if (!recommendation) throw new HttpError(404, "Recommendation not found");
  if (recommendation.status !== "PENDING") {
    throw new HttpError(409, `Recommendation is already ${recommendation.status.toLowerCase()}`);
  }

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.recommendation.update({
      where: { id },
      data: { status: "REJECTED", rejectReason: reason, decidedAt: now },
    }),
    prisma.auditLog.create({
      data: {
        entity: "recommendation",
        entityId: id,
        action: "REJECTED",
        payload: { reason },
      },
    }),
  ]);

  return updated;
}
