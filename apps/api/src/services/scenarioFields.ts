import { savingsVsBaseline, type ScenarioId, type ScenarioSet } from "@maritime/shared";

/**
 * Recommendation columns derived from a scenario set: the speed to set and
 * the savings of scenario `id` against baseline A. Kept as columns (not only
 * in the JSON) so totals and the Ask page can aggregate them cheaply.
 */
export function recommendationFields(set: ScenarioSet, id: ScenarioId = set.recommendedId) {
  const s = set.scenarios.find((x) => x.id === id) ?? set.scenarios[0];
  const d = savingsVsBaseline(set, s.id);
  return {
    recommendedSpeedKn: s.speedKn,
    fuelSavedT: d.fuelT,
    costSavedEur: d.fuelCostEur,
    co2SavedT: d.co2T,
    etsSavedEur: d.etsCostEur,
    demurrageAvoided: d.demurrageAvoided,
  };
}

/** Read a stored Recommendation.scenarios JSON value. */
export function parseScenarioSet(value: unknown): ScenarioSet | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ScenarioSet>;
  return Array.isArray(v.scenarios) && v.scenarios.length > 0 ? (v as ScenarioSet) : null;
}
