import { describe, expect, it } from "vitest";
import { calculateJit } from "../jit.js";

describe("calculateJit", () => {
  it("matches the reference JIT case: D=1200nm, v0=14kn, 24h delay", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const currentEta = new Date(now.getTime() + (1200 / 14) * 3_600_000);
    const newBerthTime = new Date(currentEta.getTime() + 24 * 3_600_000);

    const calc = calculateJit({
      distanceNm: 1200,
      currentSpeedKn: 14,
      currentEta,
      newBerthTime,
      now,
      designSpeedKn: 14,
      fuelTPerDayAtDesign: 40,
      minSpeedKn: 9,
      auxFuelTPerDay: 3,
      fuelPriceEurPerT: 600,
      co2Factor: 3.114,
    });

    expect(calc.v1).toBeCloseTo(10.94, 1);
    expect(calc.fuelA).toBeCloseTo(145.9, 0);
    expect(calc.fuelB).toBeCloseTo(87.2, 0);
    expect(calc.fuelSavedT).toBeCloseTo(58.7, 0);
    expect(calc.costSavedEur).toBeCloseTo(35200, -2);
    expect(calc.co2SavedT).toBeCloseTo(182.7, 0);
    expect(calc.clamped).toBe(false);
  });

  it("clamps to minSpeedKn and adds residual wait when the delay is very long", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const currentEta = new Date(now.getTime() + (1200 / 14) * 3_600_000);
    const newBerthTime = new Date(currentEta.getTime() + 500 * 3_600_000);

    const calc = calculateJit({
      distanceNm: 1200,
      currentSpeedKn: 14,
      currentEta,
      newBerthTime,
      now,
      designSpeedKn: 14,
      fuelTPerDayAtDesign: 40,
      minSpeedKn: 9,
      auxFuelTPerDay: 3,
      fuelPriceEurPerT: 600,
      co2Factor: 3.114,
    });

    expect(calc.clamped).toBe(true);
    expect(calc.v1).toBeCloseTo(9, 5);
    expect(calc.residualWaitHoursPlanB).toBeGreaterThan(0);
  });

  it("never recommends a speed above the current speed", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const currentEta = new Date(now.getTime() + (1200 / 14) * 3_600_000);
    // Berth time earlier than the current ETA would require speeding up.
    const newBerthTime = new Date(currentEta.getTime() - 10 * 3_600_000);

    const calc = calculateJit({
      distanceNm: 1200,
      currentSpeedKn: 14,
      currentEta,
      newBerthTime,
      now,
      designSpeedKn: 14,
      fuelTPerDayAtDesign: 40,
      minSpeedKn: 9,
      auxFuelTPerDay: 3,
      fuelPriceEurPerT: 600,
      co2Factor: 3.114,
    });

    expect(calc.v1).toBeLessThanOrEqual(14);
  });
});

describe("calculateJit with weather", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const currentEta = new Date(now.getTime() + (1200 / 14) * 3_600_000);
  const newBerthTime = new Date(currentEta.getTime() + 24 * 3_600_000);
  const base = {
    distanceNm: 1200,
    currentSpeedKn: 14,
    currentEta,
    newBerthTime,
    now,
    designSpeedKn: 14,
    fuelTPerDayAtDesign: 40,
    minSpeedKn: 9,
    auxFuelTPerDay: 3,
    fuelPriceEurPerT: 600,
    co2Factor: 3.114,
  };

  it("is identical to the calm-water model when weather is neutral", () => {
    const calm = calculateJit(base);
    const neutral = calculateJit({ ...base, weather: { headCurrentKn: 0, seaStateFuelFactor: 1 } });
    expect(neutral.v1).toBeCloseTo(calm.v1, 6);
    expect(neutral.fuelSavedT).toBeCloseTo(calm.fuelSavedT, 6);
    expect(calm.headCurrentKn).toBe(0);
    expect(calm.seaStateFuelFactor).toBe(1);
  });

  it("asks for a higher speed through the water against a head current", () => {
    const calm = calculateJit(base);
    const head = calculateJit({ ...base, weather: { headCurrentKn: 1, seaStateFuelFactor: 1 } });
    expect(head.v1).toBeCloseTo(calm.v1 + 1, 6);
    expect(head.residualWaitHoursPlanB).toBeCloseTo(0, 6);
  });

  it("scales fuel burn by the sea-state factor", () => {
    const calm = calculateJit(base);
    const rough = calculateJit({ ...base, weather: { headCurrentKn: 0, seaStateFuelFactor: 1.1 } });
    expect(rough.fAtV0).toBeCloseTo(calm.fAtV0 * 1.1, 6);
    expect(rough.fuelSavedT).toBeGreaterThan(calm.fuelSavedT);
  });

  it("caps an extreme current so the ship always makes headway", () => {
    const calc = calculateJit({ ...base, weather: { headCurrentKn: 50, seaStateFuelFactor: 1 } });
    expect(calc.headCurrentKn).toBe(8);
    expect(Number.isFinite(calc.fuelB)).toBe(true);
  });
});
