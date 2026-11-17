import type { JitCalc, JitWeather } from "./types.js";

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
  /** Optional weather; omitted = calm water, no current (the original model). */
  weather?: JitWeather;
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
    weather,
  } = input;

  // Speeds are through the water (what the engine sets); progress is over
  // ground. A head current c slows progress: SOG = STW - c. Kept well below
  // the minimum speed so the ship always makes headway.
  const c = Math.max(-3, Math.min(weather?.headCurrentKn ?? 0, minSpeedKn - 1));
  const seaState = Math.max(1, weather?.seaStateFuelFactor ?? 1);

  const hoursAvailable = (newBerthTime.getTime() - now.getTime()) / 3_600_000;
  const v1Raw = distanceNm / hoursAvailable + c;
  const v1 = Math.min(currentSpeedKn, Math.max(minSpeedKn, v1Raw));
  const clamped = v1 !== v1Raw;

  const fAtV0 = dailyFuel(currentSpeedKn, designSpeedKn, fuelTPerDayAtDesign) * seaState;
  const fAtV1 = dailyFuel(v1, designSpeedKn, fuelTPerDayAtDesign) * seaState;

  const travelHoursPlanA = distanceNm / (currentSpeedKn - c);
  // With no current this equals newBerthTime - currentEta, as before.
  const waitHoursPlanA =
    c === 0
      ? Math.max(0, (newBerthTime.getTime() - currentEta.getTime()) / 3_600_000)
      : Math.max(0, hoursAvailable - travelHoursPlanA);
  const fuelA =
    (fAtV0 * travelHoursPlanA) / 24 + (auxFuelTPerDay * waitHoursPlanA) / 24;

  const travelHoursPlanB = distanceNm / (v1 - c);
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
    headCurrentKn: c,
    seaStateFuelFactor: seaState,
  };
}

/**
 * Re-price an existing calculation at a new fuel price. Fuel tonnes don't
 * depend on price, so only the euro figure (and the recorded assumption) change.
 */
export function repriceJit(calc: JitCalc, fuelPriceEurPerT: number): JitCalc {
  return { ...calc, fuelPriceEurPerT, costSavedEur: calc.fuelSavedT * fuelPriceEurPerT };
}
