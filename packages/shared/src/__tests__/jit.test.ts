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
