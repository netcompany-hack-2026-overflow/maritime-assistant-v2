import { readFileSync } from "node:fs";
import { haversineNm, greatCircleInterpolate, type LatLon } from "@maritime/shared";

/**
 * Coarse land check on Natural Earth 110m country polygons (apps/api/data).
 * Used to stop a bunker detour being measured as a straight line across a
 * continent (e.g. Rotterdam → Genoa over the Alps).
 */

type Ring = [number, number][]; // [lon, lat]
interface Polygon {
  rings: Ring[];
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

let polygons: Polygon[] | null = null;

function load(): Polygon[] {
  if (polygons) return polygons;
  // Same path from src/services (tsx) and dist/services (built).
  const file = new URL("../../data/land-110m.json", import.meta.url);
  const raw = JSON.parse(readFileSync(file, "utf-8")) as { polygons: Ring[][] };
  polygons = raw.polygons.map((rings) => {
    const outer = rings[0];
    return {
      rings,
      minLon: Math.min(...outer.map((c) => c[0])),
      maxLon: Math.max(...outer.map((c) => c[0])),
      minLat: Math.min(...outer.map((c) => c[1])),
      maxLat: Math.max(...outer.map((c) => c[1])),
    };
  });
  return polygons;
}

function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isOnLand(p: LatLon): boolean {
  for (const poly of load()) {
    if (p.lon < poly.minLon || p.lon > poly.maxLon || p.lat < poly.minLat || p.lat > poly.maxLat) continue;
    if (inRing(poly.rings[0], p.lon, p.lat) && !poly.rings.slice(1).some((h) => inRing(h, p.lon, p.lat))) {
      return true;
    }
  }
  return false;
}

const SAMPLE_NM = 5;
/** Ports sit on the (coarse) coastline: ignore this much at the port end. */
const PORT_END_MARGIN_NM = 15;
/** The turn-off point is on the sea route but may touch a coarse coastline in a strait. */
const ROUTE_END_MARGIN_NM = 3;

/** Does the straight line from a point on the route to a port cross land? */
export function crossesLand(fromRoute: LatLon, toPort: LatLon): boolean {
  const total = haversineNm(fromRoute, toPort);
  const steps = Math.ceil(total / SAMPLE_NM);
  for (let s = 1; s < steps; s++) {
    const d = (s / steps) * total;
    if (d < ROUTE_END_MARGIN_NM || total - d < PORT_END_MARGIN_NM) continue;
    if (isOnLand(greatCircleInterpolate(fromRoute, toPort, s / steps))) return true;
  }
  return false;
}
