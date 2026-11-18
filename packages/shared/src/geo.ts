const EARTH_RADIUS_NM = 3440.065;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance between two points, in nautical miles. */
export function haversineNm(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}

/** Initial bearing from a to b, in degrees [0, 360). */
export function initialBearing(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/**
 * Interpolate along the great-circle path from a to b.
 * fraction = 0 returns a, fraction = 1 returns b.
 */
export function greatCircleInterpolate(
  a: LatLon,
  b: LatLon,
  fraction: number
): LatLon {
  const f = Math.max(0, Math.min(1, fraction));

  const lat1 = toRad(a.lat);
  const lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat);
  const lon2 = toRad(b.lon);

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinHalfH =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const delta = 2 * Math.atan2(Math.sqrt(sinHalfH), Math.sqrt(1 - sinHalfH));

  if (delta === 0) {
    return { lat: a.lat, lon: a.lon };
  }

  const A = Math.sin((1 - f) * delta) / Math.sin(delta);
  const B = Math.sin(f * delta) / Math.sin(delta);

  const x =
    A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y =
    A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);

  return { lat: toDeg(lat), lon: toDeg(lon) };
}

/** Total length of a polyline (sum of great-circle legs), in nautical miles. */
export function polylineLengthNm(coords: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineNm(coords[i - 1], coords[i]);
  return total;
}

export interface PolylinePoint {
  position: LatLon;
  /** Bearing of the leg the point sits on, degrees [0, 360). */
  heading: number;
  /** Index of the first vertex AFTER the point (coords.slice(nextIndex) is what lies ahead). */
  nextIndex: number;
}

/**
 * Locate the point `fraction` (0..1) of the way along a polyline, measured by
 * distance. Each leg is treated as a great-circle segment.
 */
export function interpolateAlongPolyline(coords: LatLon[], fraction: number): PolylinePoint {
  if (coords.length === 0) throw new Error("interpolateAlongPolyline: empty polyline");
  if (coords.length === 1) return { position: { ...coords[0] }, heading: 0, nextIndex: 1 };

  const f = Math.max(0, Math.min(1, fraction));
  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineNm(coords[i - 1], coords[i]);
    legs.push(d);
    total += d;
  }

  let target = f * total;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const isLast = i === legs.length - 1;
    if (target <= leg || isLast) {
      const a = coords[i];
      const b = coords[i + 1];
      const legFraction = leg > 0 ? Math.min(1, target / leg) : 1;
      const position = greatCircleInterpolate(a, b, legFraction);
      const heading = leg > 0 ? initialBearing(position, b) : 0;
      return { position, heading, nextIndex: i + 1 };
    }
    target -= leg;
  }
  // unreachable
  const last = coords[coords.length - 1];
  return { position: { ...last }, heading: 0, nextIndex: coords.length };
}

/** Point reached by travelling `distanceNm` from `from` on initial bearing `bearingDeg`. */
export function destinationPoint(from: LatLon, bearingDeg: number, distanceNm: number): LatLon {
  const delta = distanceNm / EARTH_RADIUS_NM;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}
