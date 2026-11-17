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
          previousBerthTime: voyage.berthTime?.toISOString() ?? null,
          newSpeedKn,
          newPlannedEta: newPlannedEta.toISOString(),
          berthTime: portEvent.newBerthTime.toISOString(),
        },
      },
    }),
  ]);

  return { voyage: updatedVoyage };
}

/**
 * Take back an approval made by mistake: restore the voyage's previous speed
 * (and berth time) and return the recommendation to PENDING.
 */
export async function undoApproval(id: string) {
  const recommendation = await prisma.recommendation.findUnique({ where: { id } });
  if (!recommendation) throw new HttpError(404, "Recommendation not found");
  if (recommendation.status !== "APPROVED") {
    throw new HttpError(409, "Only approved recommendations can be undone");
  }

  const voyage = await prisma.voyage.findUnique({ where: { id: recommendation.voyageId } });
  if (!voyage) throw new HttpError(404, "Voyage not found");
  if (voyage.status !== "UNDERWAY") {
    throw new HttpError(409, "Voyage is no longer underway, so the approval can't be undone");
  }

  // If a later approval changed this voyage again, rolling this one back would
  // clobber it. Only the most recent approval on a voyage can be undone.
  const laterApproval = await prisma.recommendation.findFirst({
    where: {
      voyageId: voyage.id,
      status: "APPROVED",
      id: { not: id },
      decidedAt: { gt: recommendation.decidedAt ?? new Date(0) },
    },
  });
  if (laterApproval) {
    throw new HttpError(409, "A later action on this voyage was approved; undo that one first");
  }

  const approvalLog = await prisma.auditLog.findFirst({
    where: { entity: "recommendation", entityId: id, action: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  const payload = (approvalLog?.payload ?? {}) as {
    previousSpeedKn?: number;
    previousBerthTime?: string | null;
  };
  const restoredSpeedKn = payload.previousSpeedKn ?? recommendation.currentSpeedKn;

  const now = new Date();
  // Same rebasing as approve: freeze the visual position at the current speed,
  // then recompute the ETA for the remaining distance at the restored speed.
  const visualSailedNm =
    voyage.sailedNmAtRebase + simHoursSince(voyage.rebasedAt, env.simSpeed, now) * voyage.speedKn;
  const remainingNm = Math.max(
    0,
    (voyage.speedKn * (voyage.plannedEta.getTime() - now.getTime())) / 3_600_000
  );
  const hoursAtRestoredSpeed = restoredSpeedKn > 0 ? remainingNm / restoredSpeedKn : 0;
  const restoredEta = new Date(now.getTime() + hoursAtRestoredSpeed * 3_600_000);

  const [updatedVoyage, updatedRecommendation] = await prisma.$transaction([
    prisma.voyage.update({
      where: { id: voyage.id },
      data: {
        speedKn: restoredSpeedKn,
        sailedNmAtRebase: visualSailedNm,
        rebasedAt: now,
        plannedEta: restoredEta,
        ...("previousBerthTime" in payload
          ? { berthTime: payload.previousBerthTime ? new Date(payload.previousBerthTime) : null }
          : {}),
      },
    }),
    prisma.recommendation.update({
      where: { id },
      data: { status: "PENDING", decidedAt: null },
    }),
    prisma.auditLog.create({
      data: {
        entity: "recommendation",
        entityId: id,
        action: "APPROVAL_UNDONE",
        payload: {
          voyageId: voyage.id,
          undoneSpeedKn: voyage.speedKn,
          restoredSpeedKn,
          restoredPlannedEta: restoredEta.toISOString(),
        },
      },
    }),
  ]);

  return { voyage: updatedVoyage, recommendation: updatedRecommendation };
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
