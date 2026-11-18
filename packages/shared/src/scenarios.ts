import type { CharterPartyTerms } from "./charterParty.js";
import { assessCii, type CiiAssessment } from "./cii.js";
import { etsCostEur, etsCoveredShare } from "./ets.js";
import { assessJitCoverage, assessLaytime, type JitCoverage, type LaytimeAssessment } from "./laytime.js";
import type { LatLon } from "./geo.js";

/**
 * Arrival scenarios for one voyage after a port event:
 *   A — same speed, same route (baseline: rush, then wait at anchor)
 *   B — same route, speed reduced to arrive just in time
 *   C — weather-routed alternative route, at the speed that makes the berth time
 *
 * Physical quantities (hours, tonnes) are computed once in buildScenarios;
 * money is derived from them in priceScenarios, so a fuel- or carbon-price
 * change re-prices without re-running the voyage model.
 */
export type ScenarioId = "A" | "B" | "C";

export interface RouteWeather {
  /** Mean adverse (+) / following (−) current along the leg, kn. */
  headCurrentKn: number;
  /** Multiplier on daily main-engine fuel for waves; 1 = calm. */
  seaStateFuelFactor: number;
  /** Mean / max significant wave height along the leg, m (null when unknown). */
  meanWaveM: number | null;
  maxWaveM: number | null;
  description: string;
  source: "open-meteo" | "mock";
}

export interface ScenarioRoute {
  distanceNm: number;
  weather: RouteWeather;
  /** Polyline from the current position to the port (for the map). */
  coords?: LatLon[];
  /** e.g. "via 47.1°N 8.3°W (avoids 4.6 m seas off Finisterre)". */
  via?: string;
}

export interface VesselParams {
  type: string;
  dwt: number;
  designSpeedKn: number;
  minSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  /** Year-to-date operational data for the annual CII projection (optional). */
  ytdCo2T: number | null;
  ytdDistanceNm: number | null;
}

export interface Prices {
  fuelPriceEurPerT: number;
  euaPriceEurPerT: number;
}

export interface ScenarioInput {
  now: Date;
  berthTime: Date;
  currentSpeedKn: number;
  vessel: VesselParams;
  baseRoute: ScenarioRoute;
  altRoute: ScenarioRoute | null;
  co2Factor: number;
  prices: Prices;
  /** Emissions / CII year. */
  year: number;
  /** EU ETS geographic scope of this voyage: 1, 0.5 or 0. */
  etsVoyageScope: number;
  charterParty: CharterPartyTerms | null;
  /** Expected cargo-operations hours at the berth (for laytime). */
  opsHours: number | null;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  description: string;
  speedKn: number;
  sogKn: number;
  distanceNm: number;
  travelHours: number;
  arrivalAt: string;
  waitHours: number;
  /** Hours after the berth time (0 when on time or early). */
  lateHours: number;
  mainFuelT: number;
  auxFuelT: number;
  fuelT: number;
  co2T: number;
  /** Money: filled by priceScenarios. */
  fuelCostEur: number;
  etsCostEur: number;
  totalCostEur: number;
  weather: RouteWeather;
  via: string | null;
  coords?: LatLon[];
  cii: { voyage: CiiAssessment; annual: CiiAssessment | null };
  contract: { laytime: LaytimeAssessment | null; jit: JitCoverage };
  /** Speed clamped to the vessel's limits. */
  clamped: boolean;
}

export interface ScenarioSet {
  generatedAt: string;
  berthTime: string;
  year: number;
  etsVoyageScope: number;
  etsCoveredShare: number;
  co2Factor: number;
  prices: Prices;
  scenarios: Scenario[];
  /** Lowest total cost among scenarios that make the berth time. */
  recommendedId: ScenarioId;
}

const H = 3_600_000;

function dailyFuel(v: VesselParams, speedKn: number): number {
  return v.fuelTPerDayAtDesign * (speedKn / v.designSpeedKn) ** 3;
}

/** Speed through the water that covers `distanceNm` in `hours` against current c. */
function jitSpeed(distanceNm: number, hours: number, c: number): number {
  return hours > 0 ? distanceNm / hours + c : Number.POSITIVE_INFINITY;
}

interface LegResult {
  speedKn: number;
  sogKn: number;
  travelHours: number;
  arrivalAt: Date;
  waitHours: number;
  lateHours: number;
  mainFuelT: number;
  auxFuelT: number;
}

function sailLeg(input: ScenarioInput, route: ScenarioRoute, speedKn: number): LegResult {
  const { vessel, now, berthTime } = input;
  // Keep the current below the speed so the ship always makes headway.
  const c = Math.max(-3, Math.min(route.weather.headCurrentKn, speedKn - 1));
  const sea = Math.max(1, route.weather.seaStateFuelFactor);
  const sogKn = speedKn - c;
  const travelHours = route.distanceNm / sogKn;
  const arrivalAt = new Date(now.getTime() + travelHours * H);
  const gap = (berthTime.getTime() - arrivalAt.getTime()) / H;
  const waitHours = Math.max(0, gap);
  return {
    speedKn,
    sogKn,
    travelHours,
    arrivalAt,
    waitHours,
    lateHours: Math.max(0, -gap),
    mainFuelT: (dailyFuel(vessel, speedKn) * sea * travelHours) / 24,
    auxFuelT: (vessel.auxFuelTPerDay * waitHours) / 24,
  };
}

function toScenario(
  input: ScenarioInput,
  id: ScenarioId,
  label: string,
  description: string,
  route: ScenarioRoute,
  leg: LegResult,
  clamped: boolean
): Scenario {
  const fuelT = leg.mainFuelT + leg.auxFuelT;
  const co2T = fuelT * input.co2Factor;
  const { vessel, year } = input;
  const voyage = assessCii(vessel.type, vessel.dwt, co2T, route.distanceNm, year);
  const annual =
    vessel.ytdCo2T != null && vessel.ytdDistanceNm != null
      ? assessCii(vessel.type, vessel.dwt, vessel.ytdCo2T + co2T, vessel.ytdDistanceNm + route.distanceNm, year)
      : null;
  const laytime =
    input.charterParty && input.opsHours != null
      ? assessLaytime(input.charterParty, leg.arrivalAt, input.berthTime, input.opsHours)
      : null;
  const speedReduced = leg.speedKn < input.currentSpeedKn - 0.05;
  return {
    id,
    label,
    description,
    speedKn: leg.speedKn,
    sogKn: leg.sogKn,
    distanceNm: route.distanceNm,
    travelHours: leg.travelHours,
    arrivalAt: leg.arrivalAt.toISOString(),
    waitHours: leg.waitHours,
    lateHours: leg.lateHours,
    mainFuelT: leg.mainFuelT,
    auxFuelT: leg.auxFuelT,
    fuelT,
    co2T,
    fuelCostEur: 0,
    etsCostEur: 0,
    totalCostEur: 0,
    weather: route.weather,
    via: route.via ?? null,
    coords: route.coords,
    cii: { voyage, annual },
    contract: { laytime, jit: assessJitCoverage(input.charterParty, speedReduced) },
    clamped,
  };
}

export function buildScenarios(input: ScenarioInput): ScenarioSet {
  const { vessel, now, berthTime, currentSpeedKn, baseRoute, altRoute } = input;
  const hoursAvailable = (berthTime.getTime() - now.getTime()) / H;

  const legA = sailLeg(input, baseRoute, currentSpeedKn);
  const scenarios: Scenario[] = [
    toScenario(
      input,
      "A",
      "Baseline",
      `Keep ${currentSpeedKn.toFixed(1)} kn on the planned route, then wait at anchor for the berth.`,
      baseRoute,
      legA,
      false
    ),
  ];

  // B: never faster than now (that is not what a delay calls for), never below minimum.
  const rawB = jitSpeed(baseRoute.distanceNm, hoursAvailable, baseRoute.weather.headCurrentKn);
  const vB = Math.min(currentSpeedKn, Math.max(vessel.minSpeedKn, rawB));
  scenarios.push(
    toScenario(
      input,
      "B",
      "Just-in-time",
      `Slow to ${vB.toFixed(1)} kn on the planned route to arrive when the berth is ready.`,
      baseRoute,
      sailLeg(input, baseRoute, vB),
      vB !== rawB
    )
  );

  if (altRoute) {
    // C: the weather route may be longer, so allow up to design speed.
    const maxC = Math.max(currentSpeedKn, vessel.designSpeedKn);
    const rawC = jitSpeed(altRoute.distanceNm, hoursAvailable, altRoute.weather.headCurrentKn);
    const vC = Math.min(maxC, Math.max(vessel.minSpeedKn, rawC));
    scenarios.push(
      toScenario(
        input,
        "C",
        "Weather route",
        `Re-route ${altRoute.via ?? "around the weather"} and sail ${vC.toFixed(1)} kn to make the berth time.`,
        altRoute,
        sailLeg(input, altRoute, vC),
        vC !== rawC
      )
    );
  }

  const set: ScenarioSet = {
    generatedAt: now.toISOString(),
    berthTime: berthTime.toISOString(),
    year: input.year,
    etsVoyageScope: input.etsVoyageScope,
    etsCoveredShare: etsCoveredShare({ year: input.year, voyageScope: input.etsVoyageScope }),
    co2Factor: input.co2Factor,
    prices: input.prices,
    scenarios,
    recommendedId: "A",
  };
  return priceScenarios(set, input.prices);
}

/** (Re-)derive € figures and the recommended scenario from physical quantities. */
export function priceScenarios(set: ScenarioSet, prices: Prices): ScenarioSet {
  const ets = { euaPriceEurPerT: prices.euaPriceEurPerT, year: set.year, voyageScope: set.etsVoyageScope };
  const scenarios = set.scenarios.map((s) => {
    const fuelCostEur = s.fuelT * prices.fuelPriceEurPerT;
    const etsCost = etsCostEur(s.co2T, ets);
    return { ...s, fuelCostEur, etsCostEur: etsCost, totalCostEur: fuelCostEur + etsCost };
  });
  // Half an hour of slack: the clamp/rounding can leave a few minutes late.
  const onTime = scenarios.filter((s) => s.lateHours <= 0.5);
  const pool = onTime.length > 0 ? onTime : scenarios;
  const best = pool.reduce((a, b) => (b.totalCostEur < a.totalCostEur - 1 ? b : a));
  return { ...set, prices, scenarios, recommendedId: best.id };
}

export interface ScenarioDelta {
  fuelT: number;
  co2T: number;
  fuelCostEur: number;
  etsCostEur: number;
  totalCostEur: number;
  /** Demurrage avoided vs baseline, in CP currency (null without a CP). */
  demurrageAvoided: number | null;
}

/** Savings of `s` relative to the baseline scenario A (positive = better). */
export function savingsVsBaseline(set: ScenarioSet, id: ScenarioId): ScenarioDelta {
  const a = set.scenarios.find((s) => s.id === "A")!;
  const s = set.scenarios.find((x) => x.id === id) ?? a;
  const dA = a.contract.laytime?.demurrageAmount;
  const dS = s.contract.laytime?.demurrageAmount;
  return {
    fuelT: a.fuelT - s.fuelT,
    co2T: a.co2T - s.co2T,
    fuelCostEur: a.fuelCostEur - s.fuelCostEur,
    etsCostEur: a.etsCostEur - s.etsCostEur,
    totalCostEur: a.totalCostEur - s.totalCostEur,
    demurrageAvoided: dA != null && dS != null ? dA - dS : null,
  };
}
