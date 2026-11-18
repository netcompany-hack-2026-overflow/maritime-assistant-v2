import type { Prisma } from "@prisma/client";
import {
  buildScenarios,
  calculateJit,
  charterPartyTermsSchema,
  etsVoyageScope,
  type CharterPartyTerms,
  type JitCalc,
  type ScenarioSet,
} from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { getSettings } from "../lib/settings.js";
import { getLlmProvider } from "../llm/index.js";
import { mockExplainRecommendation } from "../llm/mock.js";
import { remainingDistanceNm, voyageGeometry } from "../sim/positions.js";
import { routeWeather } from "./weather.js";
import { findWeatherRoute } from "./weatherRoute.js";
import { voyageProgressNow } from "./voyagePosition.js";
import { recommendationFields } from "./scenarioFields.js";

const H = 3_600_000;

export const voyageInclude = {
  vessel: true,
  originPort: true,
  destPort: true,
  charterParty: true,
} as const;

export type VoyageForScenarios = Prisma.VoyageGetPayload<{ include: typeof voyageInclude }>;

export function parseTerms(value: unknown): CharterPartyTerms | null {
  const parsed = charterPartyTermsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface ScenarioComputation {
  set: ScenarioSet;
  /** Scenario-B math in the original JitCalc shape (the "Show the math" table). */
  calc: JitCalc;
}

/**
 * Build scenarios A/B/C for a voyage that must reach the berth at `berthTime`.
 * Returns null when the ship is already in (no distance left).
 */
export async function computeScenarios(
  voyage: VoyageForScenarios,
  berthTime: Date,
  now: Date = new Date()
): Promise<ScenarioComputation | null> {
  const distanceNm = remainingDistanceNm(voyage, now);
  if (distanceNm <= 0) return null;

  const settings = await getSettings();
  // Live AIS: the route from the reported position. Otherwise the part of the
  // route still ahead on the real timeline, which matches `distanceNm`
  // (the globe animation runs faster than real time).
  const live = voyageGeometry(voyage, env.simSpeed, now);
  const geometry = live.live ? live : { ...live, ahead: voyageProgressNow(voyage, now).ahead };
  const hoursAvailable = (berthTime.getTime() - now.getTime()) / H;

  const base = await routeWeather(geometry.ahead, now, voyage.speedKn, distanceNm);
  const alt = await findWeatherRoute({
    ahead: geometry.ahead,
    base,
    legNm: distanceNm,
    startAt: now,
    hoursAvailable,
    speedKn: voyage.speedKn,
  });
  const { samples: _samples, ...baseWeather } = base;

  const cp = voyage.charterParty;
  const terms = cp ? parseTerms(cp.terms) : null;
  const opsHours = cp?.expectedOpsHours ?? (terms?.laytimeHours != null ? terms.laytimeHours * 0.8 : null);

  const set = buildScenarios({
    now,
    berthTime,
    currentSpeedKn: voyage.speedKn,
    vessel: voyage.vessel,
    baseRoute: { distanceNm, weather: baseWeather, coords: geometry.ahead },
    altRoute: alt,
    co2Factor: settings.co2Factor,
    prices: { fuelPriceEurPerT: settings.fuelPriceEurPerT, euaPriceEurPerT: settings.euaPriceEurPerT },
    year: now.getUTCFullYear(),
    etsVoyageScope: etsVoyageScope(voyage.originPort.country, voyage.destPort.country),
    charterParty: terms,
    opsHours,
  });

  const calc = calculateJit({
    distanceNm,
    currentSpeedKn: voyage.speedKn,
    currentEta: new Date(now.getTime() + (distanceNm / voyage.speedKn) * H),
    newBerthTime: berthTime,
    now,
    designSpeedKn: voyage.vessel.designSpeedKn,
    fuelTPerDayAtDesign: voyage.vessel.fuelTPerDayAtDesign,
    minSpeedKn: voyage.vessel.minSpeedKn,
    auxFuelTPerDay: voyage.vessel.auxFuelTPerDay,
    fuelPriceEurPerT: settings.fuelPriceEurPerT,
    co2Factor: settings.co2Factor,
    weather: { headCurrentKn: baseWeather.headCurrentKn, seaStateFuelFactor: baseWeather.seaStateFuelFactor },
  });

  return { set, calc };
}

/** Plain-language rationale for the recommended scenario, from the LLM (or the offline template). */
export async function rationaleFor(
  voyage: VoyageForScenarios,
  portEvent: { eventType: string; delayHours: number | null },
  set: ScenarioSet,
  opts: { offline?: boolean } = {}
): Promise<string> {
  const explain = opts.offline ? mockExplainRecommendation : (f: Parameters<typeof mockExplainRecommendation>[0]) => getLlmProvider().explainRecommendation(f);
  const rec = set.scenarios.find((s) => s.id === set.recommendedId)!;
  const f = recommendationFields(set, rec.id);
  const terms = voyage.charterParty ? parseTerms(voyage.charterParty.terms) : null;
  return explain({
    vesselName: voyage.vessel.name,
    originPortName: voyage.originPort.name,
    destPortName: voyage.destPort.name,
    portEventType: portEvent.eventType,
    portName: voyage.destPort.name,
    delayHours: portEvent.delayHours ?? 0,
    currentSpeedKn: voyage.speedKn,
    recommendedSpeedKn: rec.speedKn,
    fuelSavedT: f.fuelSavedT,
    costSavedEur: f.costSavedEur,
    co2SavedT: f.co2SavedT,
    scenarioLabel: `${rec.id} — ${rec.label}`,
    scenarioDescription: rec.description,
    etsSavedEur: f.etsSavedEur,
    demurrageAvoided: f.demurrageAvoided,
    currency: terms?.currency ?? null,
    jitNote: rec.contract.jit.note,
    weather: rec.weather.description,
  });
}

/**
 * Re-run the scenarios of a PENDING recommendation with current position,
 * weather, prices and charter party. Approved/rejected ones are history and
 * are left alone. `withRationale: false` writes the rationale from the offline
 * template instead of the LLM (the AIS loop: a moving ship should not call the
 * LLM every few minutes, but the text must still match the new numbers).
 */
export async function recomputeRecommendation(id: string, opts: { withRationale?: boolean } = {}) {
  const rec = await prisma.recommendation.findUnique({
    where: { id },
    include: { portEvent: true, voyage: { include: voyageInclude } },
  });
  if (!rec || rec.status !== "PENDING" || rec.voyage.status !== "UNDERWAY") return null;
  const berthTime = rec.portEvent.newBerthTime;
  if (!berthTime) return null;

  const result = await computeScenarios(rec.voyage, berthTime);
  if (!result) return null;
  const rationale = await rationaleFor(rec.voyage, rec.portEvent, result.set, {
    offline: opts.withRationale === false,
  });

  return prisma.recommendation.update({
    where: { id },
    data: {
      ...recommendationFields(result.set),
      currentSpeedKn: rec.voyage.speedKn,
      calc: result.calc as unknown as Prisma.InputJsonValue,
      scenarios: result.set as unknown as Prisma.InputJsonValue,
      rationale,
    },
  });
}

/** Recompute every pending recommendation on a voyage (after a CP upload or an AIS update). */
export async function recomputeVoyage(voyageId: string, opts: { withRationale?: boolean } = {}) {
  const pending = await prisma.recommendation.findMany({
    where: { voyageId, status: "PENDING" },
    select: { id: true },
  });
  let n = 0;
  for (const r of pending) {
    if (await recomputeRecommendation(r.id, opts)) n++;
  }
  return n;
}
