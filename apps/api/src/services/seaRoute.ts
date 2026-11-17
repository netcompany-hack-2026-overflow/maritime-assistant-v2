import { createRequire } from "node:module";
import { haversineNm, polylineLengthNm, type LatLon } from "@maritime/shared";

/**
 * Sea routing on the Eurostat maritime network via searoute-js.
 * Wrapped here so the rest of the app only sees {coords, lengthNm} and the
 * library can be swapped out.
 */

type Searoute = typeof import("searoute-js").default;
const require = createRequire(import.meta.url);
let searouteFn: Searoute | null = null;

function searoute(): Searoute {
  if (!searouteFn) searouteFn = require("searoute-js") as Searoute;
  return searouteFn;
}

const pointFeature = (p: LatLon) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] },
});

/** searoute-js logs on every call; keep that out of the API logs. */
function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

function rawRoute(a: LatLon, b: LatLon): LatLon[] | null {
  try {
    const line = quiet(() => searoute()(pointFeature(a), pointFeature(b)));
    if (!line) return null;
    return line.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  } catch {
    return null;
  }
}

// A point in the open Atlantic that every connected part of the network reaches.
const HUB: LatLon = { lat: 30, lon: -30 };
const OFFSETS_DEG = [0.25, 0.5, 1];
const DIRECTIONS: [number, number][] = [
  [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const snapCache = new Map<string, LatLon>();

/**
 * Some ports snap onto a disconnected fragment of the network (e.g. Algeciras),
 * so the library finds no route. Nudge the query point into nearby water until
 * it snaps onto the connected network.
 */
function routablePoint(p: LatLon): LatLon {
  const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const cached = snapCache.get(key);
  if (cached) return cached;

  let found = p;
  if (!rawRoute(p, HUB)) {
    outer: for (const d of OFFSETS_DEG) {
      for (const [dy, dx] of DIRECTIONS) {
        const candidate = { lat: p.lat + dy * d, lon: p.lon + dx * d };
        if (rawRoute(candidate, HUB)) {
          found = candidate;
          break outer;
        }
      }
    }
  }
  snapCache.set(key, found);
  return found;
}

export interface SeaRoute {
  coords: LatLon[];
  lengthNm: number;
  /** false when no sea route was found and we fell back to a straight line. */
  viaNetwork: boolean;
}

const routeCache = new Map<string, SeaRoute>();

export function getSeaRoute(origin: LatLon, dest: LatLon): SeaRoute {
  const key = `${origin.lat},${origin.lon}|${dest.lat},${dest.lon}`;
  const cached = routeCache.get(key);
  if (cached) return cached;

  let result: SeaRoute;
  const path = rawRoute(routablePoint(origin), routablePoint(dest));
  if (path && path.length >= 2) {
    // The library starts/ends at the nearest network vertex, not the port.
    const coords = [origin, ...path, dest].filter(
      (c, i, arr) => i === 0 || haversineNm(arr[i - 1], c) > 0.01
    );
    result = { coords, lengthNm: polylineLengthNm(coords), viaNetwork: true };
  } else {
    result = { coords: [origin, dest], lengthNm: haversineNm(origin, dest), viaNetwork: false };
  }
  routeCache.set(key, result);
  return result;
}

type PortLike = { lat: number; lon: number };

export function routeBetweenPorts(origin: PortLike, dest: PortLike): SeaRoute {
  return getSeaRoute({ lat: origin.lat, lon: origin.lon }, { lat: dest.lat, lon: dest.lon });
}

/** Read a stored Voyage.routeCoords JSON value, or null if missing/malformed. */
export function parseStoredRoute(value: unknown): LatLon[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const coords: LatLon[] = [];
  for (const c of value) {
    if (!c || typeof c !== "object") return null;
    const { lat, lon } = c as Record<string, unknown>;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    coords.push({ lat, lon });
  }
  return coords;
}
