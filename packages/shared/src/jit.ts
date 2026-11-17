import type { JitCalc } from "./types.js";

export interface JitInput {
  distanceNm: number;
  currentSpeedKn: number;
  currentEta: Date;
  newBerthTime: Date;
  now: Date;
  designSpeedKn: number;
  fuelTPerDayAtDesign: number;
  minSpeedKn: number;
  auxFuelTPerDay: number;
  fuelPriceEurPerT: number;
  co2Factor: number;
}

function dailyFuel(speedKn: number, designSpeedKn: number, fuelTPerDayAtDesign: number): number {
  return fuelTPerDayAtDesign * (speedKn / designSpeedKn) ** 3;
}

/**
 * Just-in-time arrival speed calculation. Pure function, no I/O.
 * See README "Assumptions" for the cube-law fuel model and JIT scenario.
 */
export function calculateJit(input: JitInput): JitCalc {
  const {
    distanceNm,
    currentSpeedKn,
    currentEta,
    newBerthTime,
    now,
    designSpeedKn,
    fuelTPerDayAtDesign,
    minSpeedKn,
    auxFuelTPerDay,
    fuelPriceEurPerT,
    co2Factor,
  } = input;

  const hoursAvailable = (newBerthTime.getTime() - now.getTime()) / 3_600_000;
  const v1Raw = distanceNm / hoursAvailable;
  const v1 = Math.min(currentSpeedKn, Math.max(minSpeedKn, v1Raw));
  const clamped = v1 !== v1Raw;

  const fAtV0 = dailyFuel(currentSpeedKn, designSpeedKn, fuelTPerDayAtDesign);
  const fAtV1 = dailyFuel(v1, designSpeedKn, fuelTPerDayAtDesign);

  const waitHoursPlanA = Math.max(
    0,
    (newBerthTime.getTime() - currentEta.getTime()) / 3_600_000
  );
  const travelHoursPlanA = distanceNm / currentSpeedKn;
  const fuelA =
    (fAtV0 * travelHoursPlanA) / 24 + (auxFuelTPerDay * waitHoursPlanA) / 24;

  const travelHoursPlanB = distanceNm / v1;
  const residualWaitHoursPlanB = Math.max(0, hoursAvailable - travelHoursPlanB);
  const fuelB =
    (fAtV1 * travelHoursPlanB) / 24 +
    (auxFuelTPerDay * residualWaitHoursPlanB) / 24;

  const fuelSavedT = fuelA - fuelB;
  const costSavedEur = fuelSavedT * fuelPriceEurPerT;
  const co2SavedT = fuelSavedT * co2Factor;

  return {
    distanceNm,
    hoursAvailable,
    v0: currentSpeedKn,
    v1Raw,
    v1,
    clamped,
    fuelTPerDayAtDesign,
    designSpeedKn,
    fAtV0,
    fAtV1,
    auxFuelTPerDay,
    fuelPriceEurPerT,
    co2Factor,
    waitHoursPlanA,
    residualWaitHoursPlanB,
    fuelA,
    fuelB,
    fuelSavedT,
    costSavedEur,
    co2SavedT,
  };
}
