import { routeAhead, type LatLon } from "@maritime/shared";
import { parseStoredRoute, routeBetweenPorts } from "./seaRoute.js";

type VoyageLike = {
  speedKn: number;
  plannedEta: Date;
  routeCoords: unknown;
  originPort: { lat: number; lon: number };
  destPort: { lat: number; lon: number };
};

/**
 * Where a voyage is on the real operational timeline (the one recommendations
 * use: remaining = speed × time to planned ETA), as distance left and the part
 * of the sea route still ahead. Independent of the accelerated globe animation,
 * so numbers don't drift while the demo runs.
 */
export function voyageProgressNow(voyage: VoyageLike, now: Date = new Date()) {
  const remainingNm = Math.max(0, (voyage.speedKn * (voyage.plannedEta.getTime() - now.getTime())) / 3_600_000);
  const route: LatLon[] =
    parseStoredRoute(voyage.routeCoords) ?? routeBetweenPorts(voyage.originPort, voyage.destPort).coords;
  return { remainingNm, ahead: routeAhead(route, remainingNm) };
}
