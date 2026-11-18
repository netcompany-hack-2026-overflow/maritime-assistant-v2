import type { Prisma } from "@prisma/client";
import { interpolateAlongPolyline, type LatLon } from "@maritime/shared";
import type { VesselPositionDTO } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getSeaRoute, parseStoredRoute, routeBetweenPorts } from "../services/seaRoute.js";

/** An AIS fix older than this is ignored and the ship falls back to the simulation. */
export const AIS_FRESH_MS = 2 * 3_600_000;

interface AisFields {
  mmsi: string | null;
  aisLat: number | null;
  aisLon: number | null;
  aisSogKn: number | null;
  aisCogDeg: number | null;
  aisAt: Date | null;
}

export interface AisFix {
  lat: number;
  lon: number;
  sogKn: number;
  cogDeg: number;
  at: Date;
}

/** The vessel's latest AIS fix if it is linked and fresh, else null. */
export function freshAisFix(v: AisFields, now: Date = new Date()): AisFix | null {
  if (!v.mmsi || v.aisLat == null || v.aisLon == null || !v.aisAt) return null;
  if (now.getTime() - v.aisAt.getTime() > AIS_FRESH_MS) return null;
  return { lat: v.aisLat, lon: v.aisLon, sogKn: v.aisSogKn ?? 0, cogDeg: v.aisCogDeg ?? 0, at: v.aisAt };
}

type VoyageForGeometry = Prisma.VoyageGetPayload<{ include: { vessel: true; destPort: true; originPort: true } }>;

export interface VoyageGeometry {
  position: LatLon;
  heading: number;
  /** Route from the position to the destination port. */
  ahead: LatLon[];
  aheadNm: number;
  live: boolean;
}

/** Where the ship is now and the route it has left: from AIS when live, else the simulation. */
export function voyageGeometry(voyage: VoyageForGeometry, simSpeed: number, now: Date = new Date()): VoyageGeometry {
  const fix = freshAisFix(voyage.vessel, now);
  const dest = { lat: voyage.destPort.lat, lon: voyage.destPort.lon };
  if (fix) {
    const r = getSeaRoute({ lat: fix.lat, lon: fix.lon }, dest);
    return { position: { lat: fix.lat, lon: fix.lon }, heading: fix.cogDeg, ahead: r.coords, aheadNm: r.lengthNm, live: true };
  }
  const route = parseStoredRoute(voyage.routeCoords) ?? routeBetweenPorts(voyage.originPort, voyage.destPort).coords;
  const totalNm = voyage.routeNm ?? 0;
  const sailedNm = voyage.sailedNmAtRebase + simHoursSince(voyage.rebasedAt, simSpeed, now) * voyage.speedKn;
  const fraction = totalNm > 0 ? Math.min(1, sailedNm / totalNm) : 0;
  const { position, heading, nextIndex } = interpolateAlongPolyline(route, fraction);
  const ahead = [position, ...route.slice(nextIndex)];
  return { position, heading, ahead, aheadNm: Math.max(0, totalNm - sailedNm), live: false };
}

/**
 * Remaining distance on the operational (real-time) timeline. Live AIS: the
 * sea route from the reported position. Otherwise: what the planned speed
 * covers until the planned ETA, as the original model did.
 */
export function remainingDistanceNm(voyage: VoyageForGeometry, now: Date = new Date()): number {
  const fix = freshAisFix(voyage.vessel, now);
  if (fix) {
    return getSeaRoute({ lat: fix.lat, lon: fix.lon }, { lat: voyage.destPort.lat, lon: voyage.destPort.lon }).lengthNm;
  }
  return Math.max(0, (voyage.speedKn * (voyage.plannedEta.getTime() - now.getTime())) / 3_600_000);
}

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
    const fix = freshAisFix(voyage.vessel, now);
    if (fix) {
      // Live AIS: the reported position, and a real-time ETA at the reported speed.
      const ahead = getSeaRoute({ lat: fix.lat, lon: fix.lon }, { lat: voyage.destPort.lat, lon: voyage.destPort.lon });
      const eta = fix.sogKn > 0.5 ? new Date(now.getTime() + (ahead.lengthNm / fix.sogKn) * 3_600_000) : null;
      results.push({
        vesselId: voyage.vessel.id,
        name: voyage.vessel.name,
        lat: fix.lat,
        lon: fix.lon,
        heading: fix.cogDeg,
        speedKn: fix.sogKn,
        voyageId: voyage.id,
        originPort: voyage.originPort.name,
        destPort: voyage.destPort.name,
        etaSim: eta ? eta.toISOString() : null,
        hasPendingAction: pendingVoyageIds.has(voyage.id),
        routeAhead: ahead.coords,
        source: "ais",
        mmsi: voyage.vessel.mmsi,
        aisAt: fix.at.toISOString(),
      });
      continue;
    }

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
      source: "sim",
      mmsi: voyage.vessel.mmsi,
      aisAt: null,
    });
  }

  return results;
}
