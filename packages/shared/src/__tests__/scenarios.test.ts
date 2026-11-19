import { describe, expect, it } from "vitest";
import { calculateJit } from "../jit.js";
import { assessCii, ciiReductionFactor, ciiReference } from "../cii.js";
import { etsCostEur, etsPhaseInForYear, etsVoyageScope } from "../ets.js";
import { assessJitCoverage, assessLaytime } from "../laytime.js";
import { buildScenarios, priceScenarios, savingsVsBaseline, type ScenarioInput } from "../scenarios.js";
import type { CharterPartyTerms } from "../charterParty.js";

const H = 3_600_000;

const CP: CharterPartyTerms = {
  reference: "GENCON 1994",
  chartererName: "North Sea Grain BV",
  chartererEmail: "chartering@nsg.example",
  agentEmail: null,
  vesselName: "MV Aegean Star",
  laytimeHours: 72,
  laytimeBasis: "SHINC",
  norNoticeHours: 6,
  waitingTimeCounts: true,
  demurrageRatePerDay: 18000,
  despatchRatePerDay: 9000,
  currency: "USD",
  jitClause: {
    present: true,
    name: "BIMCO JIT Arrival Clause",
    text: "…",
    speedReductionPermitted: true,
    requiresChartererInstruction: true,
  },
  warRisksClause: { present: false, name: null, text: null, additionalPremiumForCharterers: null, crewBonusForCharterers: null },
  confidence: 0.9,
  sourceSpans: [],
};

describe("EU ETS", () => {
  it("phases in 40/70/100 % and scopes 100/50/0 %", () => {
    expect(etsPhaseInForYear(2024)).toBe(0.4);
    expect(etsPhaseInForYear(2025)).toBe(0.7);
    expect(etsPhaseInForYear(2026)).toBe(1);
    expect(etsVoyageScope("Greece", "Netherlands")).toBe(1);
    expect(etsVoyageScope("Germany", "Singapore")).toBe(0.5);
    expect(etsVoyageScope("Brazil", "United States")).toBe(0);
    expect(etsCostEur(100, { euaPriceEurPerT: 90, year: 2026, voyageScope: 0.5 })).toBe(4500);
    expect(etsCostEur(100, { euaPriceEurPerT: 90, year: 2025, voyageScope: 1 })).toBeCloseTo(6300);
  });
});

describe("CII", () => {
  it("uses the G2 reference line and G3 reduction factors", () => {
    // Bulk carrier 45,000 dwt: 4745 × 45000^-0.622
    expect(ciiReference("BULK", 45_000)).toBeCloseTo(4745 * 45_000 ** -0.622, 6);
    expect(ciiReductionFactor(2026)).toBe(11);
    expect(ciiReductionFactor(2030)).toBe(21.5);
    expect(ciiReductionFactor(2035)).toBe(21.5);
  });

  it("rates against the A–E boundaries", () => {
    const required = (1 - 0.11) * ciiReference("BULK", 50_000);
    const rate = (ratio: number) => {
      const distance = 10_000;
      const co2T = (ratio * required * 50_000 * distance) / 1e6;
      return assessCii("Bulk Carrier", 50_000, co2T, distance, 2026).rating;
    };
    expect(rate(0.8)).toBe("A");
    expect(rate(0.9)).toBe("B");
    expect(rate(1.0)).toBe("C");
    expect(rate(1.1)).toBe("D");
    expect(rate(1.3)).toBe("E");
  });
});

describe("laytime", () => {
  const berth = new Date("2026-11-25T12:00:00Z");

  it("counts waiting after NOR turn time when WIBON, and charges demurrage", () => {
    const arrival = new Date(berth.getTime() - 24 * H);
    const lt = assessLaytime(CP, arrival, berth, 60)!;
    expect(lt.waitingCountedHours).toBeCloseTo(18);
    expect(lt.usedHours).toBeCloseTo(78);
    expect(lt.demurrageHours).toBeCloseTo(6);
    expect(lt.demurrageAmount).toBeCloseTo(4500);
    expect(lt.withinLaytime).toBe(false);
  });

  it("just-in-time arrival keeps within laytime and earns despatch", () => {
    const lt = assessLaytime(CP, berth, berth, 60)!;
    expect(lt.waitingCountedHours).toBe(0);
    expect(lt.withinLaytime).toBe(true);
    expect(lt.despatchHours).toBeCloseTo(12);
    expect(lt.despatchAmount).toBeCloseTo(4500);
  });

  it("does not count waiting on a berth charter", () => {
    const arrival = new Date(berth.getTime() - 24 * H);
    const lt = assessLaytime({ ...CP, waitingTimeCounts: false }, arrival, berth, 60)!;
    expect(lt.waitingCountedHours).toBe(0);
  });

  it("checks the JIT clause", () => {
    expect(assessJitCoverage(CP, false).status).toBe("NOT_APPLICABLE");
    expect(assessJitCoverage(CP, true).status).toBe("NEEDS_INSTRUCTION");
    expect(assessJitCoverage({ ...CP, jitClause: { ...CP.jitClause, requiresChartererInstruction: false } }, true).status).toBe("COVERED");
    expect(assessJitCoverage({ ...CP, jitClause: { ...CP.jitClause, present: false } }, true).status).toBe("NOT_COVERED");
    expect(assessJitCoverage(null, true).status).toBe("NO_CHARTER_PARTY");
  });
});

function input(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  const now = new Date("2026-01-01T00:00:00Z");
  const eta = new Date(now.getTime() + (1200 / 14) * H);
  return {
    now,
    berthTime: new Date(eta.getTime() + 24 * H),
    currentSpeedKn: 14,
    vessel: {
      type: "Bulk Carrier",
      dwt: 45_000,
      designSpeedKn: 14,
      minSpeedKn: 9,
      fuelTPerDayAtDesign: 40,
      auxFuelTPerDay: 3,
      ytdCo2T: 30_000,
      ytdDistanceNm: 60_000,
    },
    baseRoute: {
      distanceNm: 1200,
      weather: { headCurrentKn: 0, seaStateFuelFactor: 1, meanWaveM: null, maxWaveM: null, description: "calm", source: "mock" },
    },
    altRoute: null,
    co2Factor: 3.114,
    prices: { fuelPriceEurPerT: 600, euaPriceEurPerT: 90 },
    year: 2026,
    etsVoyageScope: 1,
    charterParty: CP,
    opsHours: 60,
    ...overrides,
  };
}

describe("buildScenarios", () => {
  it("B matches the existing JIT engine on the reference case", () => {
    const i = input();
    const set = buildScenarios(i);
    const jit = calculateJit({
      distanceNm: 1200,
      currentSpeedKn: 14,
      currentEta: new Date(i.now.getTime() + (1200 / 14) * H),
      newBerthTime: i.berthTime,
      now: i.now,
      designSpeedKn: 14,
      fuelTPerDayAtDesign: 40,
      minSpeedKn: 9,
      auxFuelTPerDay: 3,
      fuelPriceEurPerT: 600,
      co2Factor: 3.114,
    });
    const [a, b] = set.scenarios;
    expect(a.fuelT).toBeCloseTo(jit.fuelA, 6);
    expect(b.fuelT).toBeCloseTo(jit.fuelB, 6);
    expect(b.speedKn).toBeCloseTo(jit.v1, 6);
    expect(a.waitHours).toBeCloseTo(24, 6);
    expect(b.waitHours).toBeCloseTo(0, 6);
    expect(set.recommendedId).toBe("B");
  });

  it("prices fuel and EU ETS and reports demurrage avoided", () => {
    const set = buildScenarios(input());
    const [a, b] = set.scenarios;
    expect(a.etsCostEur).toBeCloseTo(a.co2T * 90, 6);
    expect(a.totalCostEur).toBeCloseTo(a.fuelCostEur + a.etsCostEur, 6);
    const d = savingsVsBaseline(set, "B");
    expect(d.fuelT).toBeCloseTo(58.7, 0);
    expect(d.etsCostEur).toBeCloseTo(58.7 * 3.114 * 90, -2);
    expect(d.demurrageAvoided).toBeCloseTo(4500);
    expect(a.contract.laytime?.withinLaytime).toBe(false);
    expect(b.contract.laytime?.withinLaytime).toBe(true);
    expect(b.contract.jit.status).toBe("NEEDS_INSTRUCTION");
  });

  it("improves the voyage CII when the ship stops waiting at anchor", () => {
    const [a, b] = buildScenarios(input()).scenarios;
    expect(b.cii.voyage.attained).toBeLessThan(a.cii.voyage.attained);
    expect(b.cii.annual!.attained).toBeLessThan(a.cii.annual!.attained);
  });

  it("adds a weather route C and picks it only when it is cheaper", () => {
    const rough = { headCurrentKn: 1, seaStateFuelFactor: 1.2, meanWaveM: 4, maxWaveM: 6, description: "rough", source: "mock" as const };
    const calmAlt = { headCurrentKn: 0, seaStateFuelFactor: 1, meanWaveM: 1, maxWaveM: 1.5, description: "calm", source: "mock" as const };
    const set = buildScenarios(
      input({
        baseRoute: { distanceNm: 1200, weather: rough },
        altRoute: { distanceNm: 1240, weather: calmAlt, via: "via the south" },
      })
    );
    expect(set.scenarios.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(set.recommendedId).toBe("C");

    const worse = buildScenarios(
      input({ altRoute: { distanceNm: 1500, weather: { ...rough }, via: "long way" } })
    );
    expect(worse.recommendedId).toBe("B");
  });

  it("re-prices without changing tonnes", () => {
    const set = buildScenarios(input());
    const repriced = priceScenarios(set, { fuelPriceEurPerT: 700, euaPriceEurPerT: 100 });
    expect(repriced.scenarios[0].fuelT).toBe(set.scenarios[0].fuelT);
    expect(repriced.scenarios[0].fuelCostEur).toBeCloseTo(set.scenarios[0].fuelT * 700, 6);
    expect(repriced.scenarios[0].etsCostEur).toBeCloseTo(set.scenarios[0].co2T * 100, 6);
  });
});
