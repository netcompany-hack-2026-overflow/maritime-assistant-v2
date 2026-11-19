import type { Prisma } from "@prisma/client";
import { polylineLengthNm, type ScenarioId } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { remainingDistanceNm, simHoursSince } from "../sim/positions.js";
import { env } from "../lib/env.js";
import { parseScenarioSet, recommendationFields } from "./scenarioFields.js";
import { draftNoticeForApproval } from "./notices.js";
import { calculateVoyageCII } from "./cii.js";
import { NOT_AT_SEA_MESSAGE, isAtSea } from "./atSea.js";
import {
  NOT_TAKEN_PREFIX,
  closeAlternatives,
  closedByApproval,
  describeOption,
  openAlternatives,
  reopenAlternatives,
} from "./alternatives.js";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function approveRecommendation(id: string, scenarioId?: ScenarioId) {
  const recommendation = await prisma.recommendation.findUnique({
    where: { id },
    include: { portEvent: { include: { port: true } } },
  });
  if (!recommendation) throw new HttpError(404, "Η σύσταση δεν βρέθηκε");
  if (recommendation.rejectReason?.startsWith(NOT_TAKEN_PREFIX)) {
    throw new HttpError(409, `${recommendation.rejectReason}. Αναιρέστε εκείνη την έγκριση για να επιλέξετε αυτή.`);
  }
  if (recommendation.status !== "PENDING") {
    throw new HttpError(409, `Η σύσταση έχει ήδη ${recommendation.status === "APPROVED" ? "εγκριθεί" : "απορριφθεί"}`);
  }

  const voyage = await prisma.voyage.findUnique({
    where: { id: recommendation.voyageId },
    include: { vessel: true, originPort: true, destPort: true },
  });
  if (!voyage) throw new HttpError(404, "Το ταξίδι δεν βρέθηκε");
  if (!isAtSea(voyage)) {
    throw new HttpError(409, NOT_AT_SEA_MESSAGE);
  }

  // The ship's other open options are alternatives to this one: approving it closes them.
  const alternatives = await openAlternatives(recommendation);
  const chosenLabel = describeOption(recommendation);

  // v1: approving a bunker call records the decision (for the agent to book);
  // the ship's plan on the globe is not re-routed through the bunker port.
  if (recommendation.actionType === "BUNKER_DETOUR") {
    const now = new Date();
    await prisma.$transaction([
      prisma.recommendation.update({ where: { id }, data: { status: "APPROVED", decidedAt: now } }),
      ...closeAlternatives(alternatives, chosenLabel, now),
      prisma.auditLog.create({
        data: {
          entity: "recommendation",
          entityId: id,
          action: "APPROVED",
          payload: {
            voyageId: voyage.id,
            actionType: "BUNKER_DETOUR",
            netEur: recommendation.costSavedEur,
            closedAlternatives: alternatives,
          },
        },
      }),
    ]);
    return { voyage, notice: null };
  }

  const portEvent = await prisma.portEvent.findUnique({ where: { id: recommendation.portEventId } });
  if (!portEvent?.newBerthTime) throw new HttpError(409, "Το συμβάν λιμανιού δεν έχει ώρα πρόσδεσης για στόχο");

  const set = parseScenarioSet(recommendation.scenarios);
  const chosenId: ScenarioId = scenarioId ?? set?.recommendedId ?? "B";
  if (chosenId === "A") {
    throw new HttpError(400, "Το σενάριο A είναι η βάση (καμία αλλαγή). Απορρίψτε καλύτερα τη σύσταση.");
  }
  const scenario = set?.scenarios.find((s) => s.id === chosenId) ?? null;
  if (set && !scenario) throw new HttpError(400, `Το σενάριο ${chosenId} δεν είναι διαθέσιμο για αυτή τη σύσταση`);
  const baseline = set?.scenarios.find((s) => s.id === "A") ?? null;

  const now = new Date();

  // Rebase the visual position tracker at the OLD speed before switching speeds,
  // so the ship's rendered position does not jump.
  const visualSailedNm =
    voyage.sailedNmAtRebase + simHoursSince(voyage.rebasedAt, env.simSpeed, now) * voyage.speedKn;

  // Remaining distance on the real (non-accelerated) operational timeline.
  let remainingNm = remainingDistanceNm(voyage, now);
  const reroute = chosenId === "C" && scenario?.coords && scenario.coords.length >= 2 && baseline;
  if (reroute) remainingNm *= scenario!.distanceNm / baseline!.distanceNm;
  // Time has passed since the scenarios were computed: re-solve the speed that
  // reaches the berth time from where the ship is now, within the scenario's
  // limits (B never faster than now; C up to design speed), same current.
  const hoursToBerth = (portEvent.newBerthTime.getTime() - now.getTime()) / 3_600_000;
  let newSpeedKn = scenario?.speedKn ?? recommendation.recommendedSpeedKn;
  let sogKn = scenario ? scenario.sogKn : newSpeedKn;
  if (scenario && hoursToBerth > 0) {
    const current = scenario.speedKn - scenario.sogKn;
    const maxKn = chosenId === "C" ? Math.max(voyage.speedKn, voyage.vessel.designSpeedKn) : voyage.speedKn;
    newSpeedKn = Math.min(maxKn, Math.max(voyage.vessel.minSpeedKn, remainingNm / hoursToBerth + current));
    sogKn = newSpeedKn - current;
  }
  sogKn = Math.max(1, sogKn);
  const remainingHoursAtNewSpeed = remainingNm / sogKn;
  const newPlannedEta = new Date(now.getTime() + remainingHoursAtNewSpeed * 3_600_000);

  const routeData = reroute
    ? {
        routeCoords: scenario!.coords as unknown as Prisma.InputJsonValue,
        routeNm: polylineLengthNm(scenario!.coords!),
        sailedNmAtRebase: 0,
      }
    : { sailedNmAtRebase: visualSailedNm };

  const fields = set ? { ...recommendationFields(set, chosenId), recommendedSpeedKn: newSpeedKn } : {};

  const newCii = calculateVoyageCII({
    dwt: voyage.vessel.dwt,
    distanceNm: (reroute ? polylineLengthNm(scenario!.coords!) : voyage.routeNm) ?? 1,
    speedKn: newSpeedKn,
    designSpeedKn: voyage.vessel.designSpeedKn,
    fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
    auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    vesselType: voyage.vessel.type,
  });

  const [updatedVoyage] = await prisma.$transaction([
    prisma.voyage.update({
      where: { id: voyage.id },
      data: {
        speedKn: newSpeedKn,
        rebasedAt: now,
        plannedEta: newPlannedEta,
        berthTime: portEvent.newBerthTime,
        ciiAttained: newCii.attained,
        ciiRating: newCii.rating,
        ...routeData,
      },
    }),
    prisma.recommendation.update({
      where: { id },
      data: { status: "APPROVED", decidedAt: now, chosenScenario: chosenId, ...fields },
    }),
    ...closeAlternatives(alternatives, chosenLabel, now),
    prisma.auditLog.create({
      data: {
        entity: "recommendation",
        entityId: id,
        action: "APPROVED",
        payload: {
          voyageId: voyage.id,
          scenario: chosenId,
          previousSpeedKn: voyage.speedKn,
          previousBerthTime: voyage.berthTime?.toISOString() ?? null,
          previousPlannedEta: voyage.plannedEta.toISOString(),
          newSpeedKn,
          newPlannedEta: newPlannedEta.toISOString(),
          berthTime: portEvent.newBerthTime.toISOString(),
          newCiiAttained: newCii.attained,
          newCiiRating: newCii.rating,
          closedAlternatives: alternatives,
          ...(reroute
            ? {
                previousRouteCoords: voyage.routeCoords as Prisma.InputJsonValue,
                previousRouteNm: voyage.routeNm,
                previousSailedNm: visualSailedNm,
              }
            : {}),
        },
      },
    }),
  ]);

  // Step 4 of the workflow: draft the notice to charterers and agent.
  let notice = null;
  if (set && scenario) {
    try {
      notice = await draftNoticeForApproval({
        recommendationId: id,
        set,
        scenario,
        previousEta: voyage.plannedEta,
        previousSpeedKn: voyage.speedKn,
        newEta: newPlannedEta,
      });
    } catch (err) {
      console.error("Could not draft the notice email:", err);
    }
  }

  return { voyage: updatedVoyage, notice };
}

/**
 * Take back an approval made by mistake: restore the voyage's previous speed
 * (and berth time) and return the recommendation to PENDING.
 */
export async function undoApproval(id: string) {
  const recommendation = await prisma.recommendation.findUnique({ where: { id } });
  if (!recommendation) throw new HttpError(404, "Η σύσταση δεν βρέθηκε");
  if (recommendation.status !== "APPROVED") {
    throw new HttpError(409, "Αναίρεση γίνεται μόνο σε εγκεκριμένες συστάσεις");
  }

  // The options this approval closed become open again.
  const reopened = await closedByApproval(id);

  if (recommendation.actionType === "BUNKER_DETOUR") {
    const [updatedRecommendation] = await prisma.$transaction([
      prisma.recommendation.update({ where: { id }, data: { status: "PENDING", decidedAt: null, chosenOption: null } }),
      ...reopenAlternatives(reopened),
      prisma.auditLog.create({
        data: { entity: "recommendation", entityId: id, action: "APPROVAL_UNDONE", payload: { actionType: "BUNKER_DETOUR" } },
      }),
    ]);
    const voyage = await prisma.voyage.findUnique({ where: { id: recommendation.voyageId } });
    return { voyage, recommendation: updatedRecommendation };
  }

  const voyage = await prisma.voyage.findUnique({
    where: { id: recommendation.voyageId },
    include: { vessel: true, originPort: true, destPort: true },
  });
  if (!voyage) throw new HttpError(404, "Το ταξίδι δεν βρέθηκε");
  if (voyage.status !== "UNDERWAY") {
    throw new HttpError(409, "Το ταξίδι δεν είναι πλέον σε εξέλιξη, οπότε η έγκριση δεν αναιρείται");
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
    throw new HttpError(409, "Εγκρίθηκε μεταγενέστερη ενέργεια σε αυτό το ταξίδι· αναιρέστε πρώτα εκείνη");
  }

  const approvalLog = await prisma.auditLog.findFirst({
    where: { entity: "recommendation", entityId: id, action: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  const payload = (approvalLog?.payload ?? {}) as {
    previousSpeedKn?: number;
    previousBerthTime?: string | null;
    previousRouteCoords?: unknown;
    previousRouteNm?: number | null;
    previousSailedNm?: number;
  };
  const restoredSpeedKn = payload.previousSpeedKn ?? recommendation.currentSpeedKn;
  const set = parseScenarioSet(recommendation.scenarios);

  const now = new Date();
  // Same rebasing as approve: freeze the visual position at the current speed,
  // then recompute the ETA for the remaining distance at the restored speed.
  const sailedSince = simHoursSince(voyage.rebasedAt, env.simSpeed, now) * voyage.speedKn;
  const visualSailedNm = voyage.sailedNmAtRebase + sailedSince;
  // A weather re-route is undone by putting the ship back on its old route,
  // as far along it as it was at approval plus what it has sailed since.
  const restoreRoute = payload.previousRouteCoords != null && payload.previousSailedNm != null;
  let remainingNm = remainingDistanceNm(voyage, now);
  if (restoreRoute && set) {
    const a = set.scenarios.find((x) => x.id === "A");
    const c = set.scenarios.find((x) => x.id === "C");
    if (a && c && c.distanceNm > 0) remainingNm *= a.distanceNm / c.distanceNm;
  }
  const hoursAtRestoredSpeed = restoredSpeedKn > 0 ? remainingNm / restoredSpeedKn : 0;
  const restoredEta = new Date(now.getTime() + hoursAtRestoredSpeed * 3_600_000);

  const restoredCii = calculateVoyageCII({
    dwt: voyage.vessel.dwt,
    distanceNm: (restoreRoute ? payload.previousRouteNm : voyage.routeNm) ?? 1,
    speedKn: restoredSpeedKn,
    designSpeedKn: voyage.vessel.designSpeedKn,
    fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
    auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    vesselType: voyage.vessel.type,
  });

  const [updatedVoyage, updatedRecommendation] = await prisma.$transaction([
    prisma.voyage.update({
      where: { id: voyage.id },
      data: {
        speedKn: restoredSpeedKn,
        rebasedAt: now,
        plannedEta: restoredEta,
        ciiAttained: restoredCii.attained,
        ciiRating: restoredCii.rating,
        ...(restoreRoute
          ? {
              routeCoords: payload.previousRouteCoords as Prisma.InputJsonValue,
              routeNm: payload.previousRouteNm ?? null,
              sailedNmAtRebase: payload.previousSailedNm! + sailedSince,
            }
          : { sailedNmAtRebase: visualSailedNm }),
        ...("previousBerthTime" in payload
          ? { berthTime: payload.previousBerthTime ? new Date(payload.previousBerthTime) : null }
          : {}),
      },
    }),
    prisma.recommendation.update({
      where: { id },
      data: {
        status: "PENDING",
        decidedAt: null,
        chosenScenario: null,
        ...(set ? recommendationFields(set) : {}),
      },
    }),
    // The notice was never sent by us; withdraw the draft so it is not sent by mistake.
    prisma.outboundEmail.updateMany({
      where: { recommendationId: id, status: "DRAFT" },
      data: { status: "WITHDRAWN" },
    }),
    ...reopenAlternatives(reopened),
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
          restoredCiiAttained: restoredCii.attained,
          restoredCiiRating: restoredCii.rating,
        },
      },
    }),
  ]);

  return { voyage: updatedVoyage, recommendation: updatedRecommendation };
}

export async function rejectRecommendation(id: string, reason: string) {
  const recommendation = await prisma.recommendation.findUnique({ where: { id } });
  if (!recommendation) throw new HttpError(404, "Η σύσταση δεν βρέθηκε");
  if (recommendation.status !== "PENDING") {
    throw new HttpError(409, `Η σύσταση έχει ήδη ${recommendation.status === "APPROVED" ? "εγκριθεί" : "απορριφθεί"}`);
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
