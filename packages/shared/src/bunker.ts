import { haversineNm, interpolateAlongPolyline, polylineLengthNm, type LatLon } from "./geo.js";
import type { BunkerCalc, BunkerReason } from "./types.js";

/**
 * The part of a route still ahead of a ship with `remainingNm` left to sail.
 * Starts at the ship's position. Measured along the polyline, so it matches
 * what the globe draws.
 */
export function routeAhead(coords: LatLon[], remainingNm: number): LatLon[] {
  const total = polylineLengthNm(coords);
  if (total <= 0) return coords.slice();
  const fraction = Math.max(0, Math.min(1, (total - remainingNm) / total));
  const { position, nextIndex } = interpolateAlongPolyline(coords, fraction);
  return [position, ...coords.slice(nextIndex)];
}

export interface NearestOnRoute {
  /** Closest point on the route to p. */
  point: LatLon;
  /** Distance from p to that point, nm. */
  offRouteNm: number;
  /** Distance along the route from its start to that point, nm. */
  alongNm: number;
}

/** Spacing of extra turn-off candidates along each leg when a blocker is given, nm. */
const CANDIDATE_SPACING_NM = 25;

/**
 * Closest point on a polyline to p. Each leg is projected in a local flat
 * (equirectangular) frame, which is accurate for the short legs of a sea route;
 * distances are then measured with haversine.
 *
 * `isBlocked(from, to)` can veto a straight line (e.g. one that crosses land):
 * the closest point with an open line to p wins. Returns null if every line is
 * blocked.
 */
export function nearestPointOnRoute(
  coords: LatLon[],
  p: LatLon,
  isBlocked?: (from: LatLon, to: LatLon) => boolean
): NearestOnRoute | null {
  if (coords.length === 0) throw new Error("nearestPointOnRoute: empty route");
  const candidates: NearestOnRoute[] = [];
  if (coords.length === 1) {
    candidates.push({ point: { ...coords[0] }, offRouteNm: haversineNm(coords[0], p), alongNm: 0 });
  }

  let along = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    const ax = a.lon * k, ay = a.lat;
    const bx = b.lon * k, by = b.lat;
    const px = p.lon * k, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const legNm = haversineNm(a, b);
    const at = (t: number): NearestOnRoute => {
      const point = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
      return { point, offRouteNm: haversineNm(point, p), alongNm: along + t * legNm };
    };
    candidates.push(at(len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0));
    if (isBlocked) {
      const steps = Math.floor(legNm / CANDIDATE_SPACING_NM);
      for (let s = 0; s <= steps; s++) candidates.push(at(steps > 0 ? s / steps : 0));
    }
    along += legNm;
  }

  candidates.sort((x, y) => x.offRouteNm - y.offRouteNm);
  if (!isBlocked) return candidates[0];
  return candidates.find((c) => !isBlocked(c.point, p)) ?? null;
}

export interface BunkerOfferInput {
  priceUsdPerT: number;
  qtyMinT: number | null;
  qtyMaxT: number | null;
  validUntil: Date | null;
}

export interface BunkerInput {
  /** Distance still to sail on the planned route, nm. */
  remainingNm: number;
  /** How far the bunker port lies off the remaining route, nm. */
  offRouteNm: number;
  /** Distance along the remaining route to the turn-off point, nm. */
  alongNm: number;
  speedKn: number;
  designSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  now: Date;
  /** Berth time, or planned ETA when no berth time is set. */
  deadline: Date;
  offer: BunkerOfferInput;
  /** Price the ship would otherwise pay for fuel (Settings fuel price), €/t. */
  refPriceEurPerT: number;
  usdEurRate: number;
  portHours: number;
  portFeeEur: number;
  /** Quantity assumed when the offer gives none, t. */
  defaultQtyT: number;
  co2Factor: number;
}

function dailyFuel(speedKn: number, designSpeedKn: number, fuelTPerDayAtDesign: number): number {
  return fuelTPerDayAtDesign * (speedKn / designSpeedKn) ** 3;
}

/** The € side of the calculation; shared by calculateBunker and repriceBunker. */
function priceSide(
  c: Pick<BunkerCalc, "priceUsdPerT" | "qtyT" | "extraFuelT" | "portFeeEur" | "arrivalOk" | "offerValidAtArrival">,
  refPriceEurPerT: number,
  usdEurRate: number
) {
  const offerPriceEurPerT = c.priceUsdPerT * usdEurRate;
  const priceSavingEur = c.qtyT * (refPriceEurPerT - offerPriceEurPerT);
  const extraFuelCostEur = c.extraFuelT * refPriceEurPerT;
  const netEur = priceSavingEur - extraFuelCostEur - c.portFeeEur;
  const reasons: BunkerReason[] = [];
  if (netEur <= 0) reasons.push("NEGATIVE_NET");
  if (!c.arrivalOk) reasons.push("LATE");
  if (!c.offerValidAtArrival) reasons.push("EXPIRED");
  return {
    refPriceEurPerT,
    usdEurRate,
    offerPriceEurPerT,
    priceSavingEur,
    extraFuelCostEur,
    netEur,
    reasons,
    verdict: reasons.length === 0 ? ("WORTH_IT" as const) : ("NOT_WORTH_IT" as const),
  };
}

/**
 * Is a bunker offer worth the detour? Pure function, no I/O.
 *
 * Two plans, both ending at the deadline (berth time):
 * - Stay: keep the current speed on the planned route, wait out any slack.
 * - Bunker: sail out to the bunker port and back (2 × off-route distance),
 *   spend portHours there, and speed up only if needed to still make the berth.
 * The detour first eats into slack the ship would have spent waiting.
 */
export function calculateBunker(input: BunkerInput): BunkerCalc {
  const {
    remainingNm,
    offRouteNm,
    alongNm,
    speedKn: v0,
    designSpeedKn,
    fuelTPerDayAtDesign,
    auxFuelTPerDay,
    now,
    deadline,
    offer,
    refPriceEurPerT,
    usdEurRate,
    portHours,
    portFeeEur,
    defaultQtyT,
    co2Factor,
  } = input;

  const detourNm = 2 * offRouteNm;
  const hoursToDeadline = (deadline.getTime() - now.getTime()) / 3_600_000;

  // Stay on route.
  const sailHoursStay = remainingNm / v0;
  const waitHoursStay = Math.max(0, hoursToDeadline - sailHoursStay);
  const fuelStayT =
    (dailyFuel(v0, designSpeedKn, fuelTPerDayAtDesign) * sailHoursStay) / 24 +
    (auxFuelTPerDay * waitHoursStay) / 24;

  // Bunker detour.
  const sailNmBunker = remainingNm + detourNm;
  const sailHoursAvailable = hoursToDeadline - portHours;
  const requiredSpeedKn = sailHoursAvailable > 0 ? sailNmBunker / sailHoursAvailable : Infinity;
  const arrivalOk = requiredSpeedKn <= designSpeedKn;
  const speedBunkerKn = Math.min(designSpeedKn, Math.max(v0, requiredSpeedKn));
  const sailHoursBunker = sailNmBunker / speedBunkerKn;
  const waitHoursBunker = Math.max(0, hoursToDeadline - portHours - sailHoursBunker);
  const lateHours = Math.max(0, sailHoursBunker + portHours - hoursToDeadline);
  const fuelBunkerT =
    (dailyFuel(speedBunkerKn, designSpeedKn, fuelTPerDayAtDesign) * sailHoursBunker) / 24 +
    (auxFuelTPerDay * (portHours + waitHoursBunker)) / 24;

  const extraFuelT = fuelBunkerT - fuelStayT;
  const extraHours = sailHoursBunker + portHours - sailHoursStay;

  const etaAtBunker = new Date(now.getTime() + ((alongNm + offRouteNm) / speedBunkerKn) * 3_600_000);
  const offerValidAtArrival = offer.validUntil === null || etaAtBunker <= offer.validUntil;
  const qtyT = offer.qtyMaxT ?? offer.qtyMinT ?? defaultQtyT;

  const base = {
    remainingNm,
    offRouteNm,
    alongNm,
    detourNm,
    hoursToDeadline,
    portHours,
    portFeeEur,
    v0,
    designSpeedKn,
    requiredSpeedKn,
    speedBunkerKn,
    sailHoursStay,
    waitHoursStay,
    sailHoursBunker,
    waitHoursBunker,
    lateHours,
    extraHours,
    fuelStayT,
    fuelBunkerT,
    extraFuelT,
    extraCo2T: extraFuelT * co2Factor,
    co2Factor,
    priceUsdPerT: offer.priceUsdPerT,
    qtyT,
    qtyAssumed: offer.qtyMaxT === null && offer.qtyMinT === null,
    etaAtBunker: etaAtBunker.toISOString(),
    validUntil: offer.validUntil ? offer.validUntil.toISOString() : null,
    offerValidAtArrival,
    arrivalOk,
  };
  return { ...base, ...priceSide(base, refPriceEurPerT, usdEurRate) };
}

/**
 * Re-price at a new fuel price or exchange rate. Distances, hours and tonnes
 * don't change; the € figures and the verdict may.
 */
export function repriceBunker(calc: BunkerCalc, refPriceEurPerT: number, usdEurRate: number): BunkerCalc {
  return { ...calc, ...priceSide(calc, refPriceEurPerT, usdEurRate) };
}

/** ["a", "b", "c"] -> "a, b and c" */
function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Why an offer isn't worth it, in plain words (null when it is), e.g.
 * "the ship would miss the Rotterdam berth by 9 h even at full speed".
 * Computed from the calc, so it stays right after re-pricing.
 */
export function bunkerVerdictReason(calc: BunkerCalc, destPortName: string): string | null {
  if (calc.verdict === "WORTH_IT") return null;
  const eurK = `€${Math.round(Math.abs(calc.netEur) / 1000).toLocaleString("en-US")}k`;
  const parts: string[] = [];
  if (calc.reasons.includes("NEGATIVE_NET")) parts.push(`the detour costs ${eurK} more than the cheaper fuel saves`);
  if (calc.reasons.includes("LATE")) {
    parts.push(`the ship would miss the ${destPortName} berth by ${calc.lateHours.toFixed(0)} h even at full speed`);
  }
  if (calc.reasons.includes("EXPIRED")) parts.push("the offer expires before the ship gets there");
  return joinAnd(parts);
}
