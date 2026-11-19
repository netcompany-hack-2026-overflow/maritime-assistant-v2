import { assessCii, type CiiRating } from "@maritime/shared";

export type CiiGrade = CiiRating;

/**
 * CII rating of a voyage at a given speed, for the Voyage.ciiAttained /
 * ciiRating columns (badges on Voyages and Fleet). Uses the IMO method shared
 * with the scenario comparison (packages/shared/src/cii.ts: G2 reference line,
 * G3 reduction factor for the year, G4 rating boundaries), so a voyage's badge
 * and its scenarios always agree.
 *
 * Fuel: cube-law main engine at `speedKn` plus auxiliary consumption, over the
 * days the voyage takes at that speed.
 */
export function calculateVoyageCII(params: {
  dwt: number;
  distanceNm: number;
  speedKn: number;
  designSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  vesselType: string;
  co2Factor?: number;
  year?: number;
}): { attained: number; rating: CiiGrade } {
  const co2Factor = params.co2Factor ?? 3.114;
  const year = params.year ?? new Date().getUTCFullYear();
  const days = params.distanceNm / (params.speedKn * 24);
  const mainFuelT = params.fuelTPerDayAtDesign * (params.speedKn / params.designSpeedKn) ** 3 * days;
  const totalFuelT = mainFuelT + params.auxFuelTPerDay * days;
  const cii = assessCii(params.vesselType, params.dwt, totalFuelT * co2Factor, params.distanceNm, year);
  return { attained: Number(cii.attained.toFixed(2)), rating: cii.rating };
}
