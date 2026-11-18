/**
 * IMO Carbon Intensity Indicator (MARPOL Annex VI, Reg. 28).
 *
 * attained CII = CO₂ (g) / (capacity × distance sailed (nm))     [AER, gCO₂/dwt·nm]
 * reference    = a × capacity^(-c)                                (G2, MEPC.353(78))
 * required     = (1 − Z/100) × reference                          (G3, MEPC.400(83))
 * rating       = A..E from attained/required vs exp(d1..d4)      (G4, MEPC.354(78))
 *
 * Pure functions, no I/O.
 */

export type CiiRating = "A" | "B" | "C" | "D" | "E";
export type CiiShipClass = "BULK" | "TANKER" | "CONTAINER" | "GENERAL_CARGO";

interface ClassParams {
  /** Capacity used in the reference line (DWT, capped for very large bulkers). */
  capacity: (dwt: number) => number;
  a: (dwt: number) => number;
  c: (dwt: number) => number;
  /** exp(d1..d4): boundaries of attained/required between A|B, B|C, C|D, D|E. */
  bounds: [number, number, number, number];
}

const PARAMS: Record<CiiShipClass, ClassParams> = {
  BULK: {
    capacity: (dwt) => Math.min(dwt, 279_000),
    a: () => 4745,
    c: () => 0.622,
    bounds: [0.86, 0.94, 1.06, 1.18],
  },
  TANKER: {
    capacity: (dwt) => dwt,
    a: () => 5247,
    c: () => 0.61,
    bounds: [0.82, 0.93, 1.08, 1.28],
  },
  CONTAINER: {
    capacity: (dwt) => dwt,
    a: () => 1984,
    c: () => 0.489,
    bounds: [0.83, 0.94, 1.07, 1.19],
  },
  GENERAL_CARGO: {
    capacity: (dwt) => dwt,
    a: (dwt) => (dwt >= 20_000 ? 31_948 : 588),
    c: (dwt) => (dwt >= 20_000 ? 0.792 : 0.3885),
    bounds: [0.83, 0.94, 1.06, 1.19],
  },
};

/** Reduction factor Z (% below the 2019 reference line) by year. */
const Z_BY_YEAR: Record<number, number> = {
  2023: 5,
  2024: 7,
  2025: 9,
  2026: 11,
  2027: 13.625,
  2028: 16.25,
  2029: 18.875,
  2030: 21.5,
};

export function ciiReductionFactor(year: number): number {
  if (year < 2023) return 0;
  // No factors are set beyond 2030 yet; hold the 2030 value.
  return Z_BY_YEAR[Math.min(year, 2030)];
}

/** Map a free-text vessel type ("Bulk Carrier", "Tanker", ...) to a CII class. */
export function ciiShipClass(vesselType: string): CiiShipClass {
  const t = vesselType.toLowerCase();
  if (t.includes("bulk")) return "BULK";
  if (t.includes("tanker")) return "TANKER";
  if (t.includes("container")) return "CONTAINER";
  return "GENERAL_CARGO";
}

export function ciiReference(cls: CiiShipClass, dwt: number): number {
  const p = PARAMS[cls];
  return p.a(dwt) * p.capacity(dwt) ** -p.c(dwt);
}

export function ciiRequired(cls: CiiShipClass, dwt: number, year: number): number {
  return (1 - ciiReductionFactor(year) / 100) * ciiReference(cls, dwt);
}

/** Attained CII in gCO₂ per dwt-nm. */
export function attainedCii(co2T: number, dwt: number, distanceNm: number, cls: CiiShipClass = "BULK"): number {
  const capacity = PARAMS[cls].capacity(dwt);
  if (capacity <= 0 || distanceNm <= 0) return Number.POSITIVE_INFINITY;
  return (co2T * 1_000_000) / (capacity * distanceNm);
}

export interface CiiAssessment {
  attained: number;
  required: number;
  /** attained / required; < 1 is better than required. */
  ratio: number;
  rating: CiiRating;
}

export function ciiRating(cls: CiiShipClass, dwt: number, attained: number, year: number): CiiAssessment {
  const required = ciiRequired(cls, dwt, year);
  const ratio = attained / required;
  const [d1, d2, d3, d4] = PARAMS[cls].bounds;
  const rating: CiiRating = ratio < d1 ? "A" : ratio < d2 ? "B" : ratio < d3 ? "C" : ratio < d4 ? "D" : "E";
  return { attained, required, ratio, rating };
}

/** Convenience: rate a quantity of CO₂ over a distance for a given vessel. */
export function assessCii(
  vesselType: string,
  dwt: number,
  co2T: number,
  distanceNm: number,
  year: number
): CiiAssessment {
  const cls = ciiShipClass(vesselType);
  return ciiRating(cls, dwt, attainedCii(co2T, dwt, distanceNm, cls), year);
}
