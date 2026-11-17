import type { Prisma } from "@prisma/client";
import { interpolateAlongPolyline } from "@maritime/shared";
import type { VesselPositionDTO } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { parseStoredRoute, routeBetweenPorts } from "../services/seaRoute.js";

/**
 * Converts elapsed real (wall-clock) time since `since` into simulated hours
 * of vessel travel. SIM_SPEED default 120 means 1 real second = 2 sim minutes:
 * simHours = realSeconds * simSpeed / 3600.
 */
export function simHoursSince(since: Date, simSpeed: number, now: Date = new Date()): number {
  const realSeconds = (now.getTime() - since.getTime()) / 1000;
  return (realSeconds * simSpeed) / 3600;
}

function realSecondsFromSimHours(simHours: number, simSpeed: number): number {
  return (simHours * 3600) / simSpeed;
}

export async function computeVesselPositions(simSpeed: number): Promise<VesselPositionDTO[]> {
  const now = new Date();

  const [voyages, pendingRecs] = await Promise.all([
    prisma.voyage.findMany({
      where: { status: "UNDERWAY" },
      include: { vessel: true, originPort: true, destPort: true },
    }),
    prisma.recommendation.findMany({
      where: { status: "PENDING" },
      select: { voyageId: true },
    }),
  ]);

  const pendingVoyageIds = new Set(pendingRecs.map((r) => r.voyageId));
  const results: VesselPositionDTO[] = [];

  for (const voyage of voyages) {
    // Ships follow the stored sea route. Voyages created before routes were
    // stored get one computed and saved on first sight.
    let route = parseStoredRoute(voyage.routeCoords);
    let totalNm = voyage.routeNm ?? 0;
    if (!route || voyage.routeNm == null) {
      const computed = routeBetweenPorts(voyage.originPort, voyage.destPort);
      route = computed.coords;
      totalNm = computed.lengthNm;
      await prisma.voyage.update({
        where: { id: voyage.id },
        data: { routeCoords: route as unknown as Prisma.InputJsonValue, routeNm: totalNm },
      });
    }

    const elapsedSimHours = simHoursSince(voyage.rebasedAt, simSpeed, now);
    const sailedNm = voyage.sailedNmAtRebase + elapsedSimHours * voyage.speedKn;

    if (totalNm > 0 && sailedNm >= totalNm) {
      await prisma.voyage.update({
        where: { id: voyage.id },
        data: { status: "ARRIVED", sailedNmAtRebase: totalNm, rebasedAt: now },
      });
      continue;
    }

    const fraction = totalNm > 0 ? sailedNm / totalNm : 0;
    const { position, heading, nextIndex } = interpolateAlongPolyline(route, fraction);
    const routeAhead = [position, ...route.slice(nextIndex)];

    const remainingNm = Math.max(0, totalNm - sailedNm);
    const remainingSimHours = voyage.speedKn > 0 ? remainingNm / voyage.speedKn : 0;
    const etaSim = new Date(
      now.getTime() + realSecondsFromSimHours(remainingSimHours, simSpeed) * 1000
    );

    results.push({
      vesselId: voyage.vessel.id,
      name: voyage.vessel.name,
      lat: position.lat,
      lon: position.lon,
      heading,
      speedKn: voyage.speedKn,
      voyageId: voyage.id,
      originPort: voyage.originPort.name,
      destPort: voyage.destPort.name,
      etaSim: etaSim.toISOString(),
      hasPendingAction: pendingVoyageIds.has(voyage.id),
      routeAhead,
    });
  }

  return results;
}
