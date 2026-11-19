import {
  destinationPoint,
  haversineNm,
  interpolateAlongPolyline,
  polylineLengthNm,
  type LatLon,
  type ScenarioRoute,
} from "@maritime/shared";
import { crossesLand, isOnLand } from "./land.js";
import { routeWeather, type RouteWeatherDetail } from "./weather.js";

/**
 * Scenario C: look for a route around the worst weather on the planned leg.
 *
 * Takes the (up to three) roughest stretches of the planned track and, around
 * each, replaces a stretch of the route with an open-water dog-leg through a
 * waypoint 60, 120 or 200 nm to either side (rejected if it touches land on the
 * Natural Earth coastlines). The rest of the planned route is kept as it is:
 * re-routing the whole leg on the sea-lane network can snap a mid-sea position
 * onto a lane that starts the wrong way. Keeps the candidate with the lowest
 * estimated fuel at the speed that still makes the berth time. A heuristic,
 * not an optimiser; the comparison shows when no alternative beats the plan.
 */

const MIN_LEG_NM = 150;
const OFFSETS_NM = [60, 120, 200];
const MAX_PIVOTS = 3;
/** Pivots closer together than this would give the same detours. */
const MIN_PIVOT_SPACING_NM = 100;
/** Weather is fetched only for this many of the shortest valid detours. */
const MAX_SCORED = 4;
/** The detour leaves and rejoins the planned track this far either side of the pivot (at least). */
const MIN_SPAN_NM = 150;
const MAX_DETOUR = 1.3;

function fmtPos(p: LatLon): string {
  const lat = `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}

/** Relative fuel for covering `nm` in `hours` with this weather (cube law). */
export function relativeFuel(nm: number, hours: number, w: { headCurrentKn: number; seaStateFuelFactor: number }): number {
  const sog = nm / hours;
  const stw = sog + w.headCurrentKn;
  return stw ** 3 * w.seaStateFuelFactor * hours;
}

export async function findWeatherRoute(args: {
  ahead: LatLon[];
  base: RouteWeatherDetail;
  /** Remaining distance on the operational timeline, nm. */
  legNm: number;
  startAt: Date;
  hoursAvailable: number;
  speedKn: number;
}): Promise<ScenarioRoute | null> {
  const { ahead, base, legNm, startAt, hoursAvailable, speedKn } = args;
  const aheadNm = polylineLengthNm(ahead);
  if (ahead.length < 2 || aheadNm < MIN_LEG_NM || hoursAvailable <= 0) return null;

  // Each sample sits at fraction (i + 0.5) / n of the route (see samplePoints).
  const n = base.samples.length;
  const indexed = base.samples.map((sample, i) => ({ sample, fraction: (i + 0.5) / n }));
  const withWaves = indexed.filter((x) => x.sample.waveM != null).sort((a, b) => b.sample.waveM! - a.sample.waveM!);
  const pivots: typeof indexed = [];
  for (const p of withWaves.length ? withWaves : [indexed[Math.floor(n / 2)]]) {
    if (!p) continue;
    if (pivots.some((q) => haversineNm(q.sample, p.sample) < MIN_PIVOT_SPACING_NM)) continue;
    pivots.push(p);
    if (pivots.length >= MAX_PIVOTS) break;
  }
  const worst = withWaves[0]?.sample ?? null;
  if (pivots.length === 0) return null;

  const scale = legNm / aheadNm;
  const valid: Array<{ coords: LatLon[]; wp: LatLon; len: number }> = [];
  for (const { sample, fraction } of pivots) {
    for (const d of OFFSETS_NM) {
      const spanF = Math.max(MIN_SPAN_NM, 2 * d) / aheadNm;
      const f0 = Math.max(0, fraction - spanF);
      const f1 = Math.min(1, fraction + spanF);
      const leave = interpolateAlongPolyline(ahead, f0);
      const rejoin = interpolateAlongPolyline(ahead, f1);
      for (const side of [90, -90]) {
        const wp = destinationPoint({ lat: sample.lat, lon: sample.lon }, sample.headingDeg + side, d);
        if (isOnLand(wp) || crossesLand(leave.position, wp) || crossesLand(wp, rejoin.position)) continue;
        const coords = [
          ...ahead.slice(0, leave.nextIndex),
          leave.position,
          wp,
          rejoin.position,
          ...ahead.slice(rejoin.nextIndex),
        ];
        const len = polylineLengthNm(coords);
        if (len < aheadNm * 1.005 || len > aheadNm * MAX_DETOUR) continue;
        if (valid.some((c) => Math.abs(c.len - len) < 1)) continue;
        valid.push({ coords, wp, len });
      }
    }
  }
  if (valid.length === 0) return null;
  const candidates = valid.sort((a, b) => a.len - b.len).slice(0, MAX_SCORED);

  const scored = await Promise.all(
    candidates.map(async (c) => {
      const nm = polylineLengthNm(c.coords) * scale;
      const weather = await routeWeather(c.coords, startAt, speedKn, nm);
      return { ...c, nm, weather, fuel: relativeFuel(nm, hoursAvailable, weather) };
    })
  );
  const best = scored.reduce((a, b) => (b.fuel < a.fuel ? b : a));
  const extra = best.nm - legNm;
  const avoided =
    worst?.waveM != null ? `, αποφεύγοντας κύμα περίπου ${worst.waveM.toFixed(1)} m στην προγραμματισμένη πορεία` : "";
  const { samples: _samples, ...weather } = best.weather;
  return {
    distanceNm: best.nm,
    weather,
    coords: best.coords,
    via: `μέσω ${fmtPos(best.wp)} (+${Math.round(extra)} nm${avoided})`,
  };
}
