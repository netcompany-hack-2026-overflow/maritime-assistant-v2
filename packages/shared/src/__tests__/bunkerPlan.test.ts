import { describe, expect, it } from "vitest";
import { calculateBunker } from "../bunker.js";
import {
  breakEvenUsdPerT,
  bunkerCalcInput,
  bunkeringHours,
  planBunkerOptions,
  screenBunkerOffer,
  stemQty,
} from "../bunkerPlan.js";
import type { BunkerPlanInput } from "../types.js";

const H = 3_600_000;
const NOW = new Date("2026-11-20T00:00:00Z");

/** MV Aegean Star, 1,700 nm from Rotterdam at its design speed, Algeciras ~10 nm off the route. */
function input(over: Partial<BunkerPlanInput> = {}, slackHours = 24): BunkerPlanInput {
  return {
    now: NOW.toISOString(),
    deadline: new Date(NOW.getTime() + (1700 / 14 + slackHours) * H).toISOString(),
    remainingNm: 1700,
    offRouteNm: 10,
    alongNm: 320,
    shipPosition: { lat: 37, lon: 0 },
    turnOff: { lat: 36, lon: -5.3 },
    bunkerPort: { lat: 36.12, lon: -5.44 },
    destination: { lat: 51.95, lon: 4.15 },
    vessel: { speedKn: 14, designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
    offer: { priceUsdPerT: 540, qtyMinT: 800, qtyMaxT: 1200, validUntil: null },
    stemQtyT: 800,
    refPriceEurPerT: 600,
    usdEurRate: 0.92,
    stdPortHours: 8,
    stdQtyT: 800,
    pumpRateTPerH: 250,
    portFeeEur: 5000,
    co2Factor: 3.114,
    delays: [],
    toleranceHours: 0.5,
    ...over,
  };
}

describe("bunkeringHours / stemQty", () => {
  it("the standard stem takes the standard time; pumping scales the rest", () => {
    expect(bunkeringHours(800, 800, 8, 250)).toBe(8);
    expect(bunkeringHours(1200, 800, 8, 250)).toBeCloseTo(9.6, 6);
    expect(bunkeringHours(500, 800, 8, 250)).toBeCloseTo(6.8, 6);
  });

  it("never less than the pumping itself plus an hour", () => {
    expect(bunkeringHours(2500, 800, 1, 250)).toBe(11);
  });

  it("the stem is clamped to what the supplier offers", () => {
    expect(stemQty(800, 900, 1200)).toEqual({ qtyT: 900, adjusted: true });
    expect(stemQty(1500, 800, 1200)).toEqual({ qtyT: 1200, adjusted: true });
    expect(stemQty(1000, null, null)).toEqual({ qtyT: 1000, adjusted: false });
  });
});

describe("screenBunkerOffer: the time cap", () => {
  it("stops when the call needs more time than the ship has to spare (+ tolerance)", () => {
    const s = screenBunkerOffer(input({}, 0));
    expect(s).toMatchObject({ passed: false, stoppedBecause: "TIME" });
    expect(s.neededHours).toBeCloseTo(8 + 20 / 14, 6);
    expect(s.overHours).toBeGreaterThan(s.toleranceHours);
  });

  it("no options are worked out for an offer it stops", () => {
    expect(planBunkerOptions(input({}, 0)).options).toEqual([]);
  });

  it("passes when the call fits in the slack", () => {
    const s = screenBunkerOffer(input({}, 24));
    expect(s.passed).toBe(true);
    expect(s.slackHours).toBeCloseTo(24, 6);
  });

  it("allows up to the tolerance over the slack, and no more", () => {
    const needed = 8 + 20 / 14;
    const slack = needed - 0.4; // 24 min over
    expect(screenBunkerOffer(input({ toleranceHours: 0.5 }, slack)).passed).toBe(true);
    expect(screenBunkerOffer(input({ toleranceHours: 0.25 }, slack)).stoppedBecause).toBe("TIME");
  });

  it("counts the worst expected delay at the bunker port", () => {
    const delays = [
      { source: "SUPPLIER_WINDOW" as const, hours: 12, note: "" },
      { source: "PORT_CONGESTION" as const, hours: 6, note: "" },
    ];
    const s = screenBunkerOffer(input({ delays }, 24));
    expect(s.delayHours).toBe(12);
    expect(s.neededHours).toBeCloseTo(8 + 12 + 20 / 14, 6);
    expect(screenBunkerOffer(input({ delays }, 15)).stoppedBecause).toBe("TIME");
  });

  it("stops when even at full speed the ship gets there after the offer expires", () => {
    const validUntil = new Date(NOW.getTime() + 10 * H).toISOString(); // ~330 nm takes ~23.6 h
    expect(screenBunkerOffer(input({ offer: { ...input().offer, validUntil } })).stoppedBecause).toBe("EXPIRED");
  });
});

describe("planBunkerOptions", () => {
  it("offers ECO (slow down, use the slack) and KEEP_SPEED (buffer), ECO first", () => {
    const { options } = planBunkerOptions(input());
    expect(options.map((o) => o.key)).toEqual(["ECO", "KEEP_SPEED"]);
    const [eco, keep] = options;
    expect(eco.calc.speedBunkerKn).toBeLessThan(14);
    expect(eco.calc.speedBunkerKn).toBeGreaterThanOrEqual(9);
    expect(keep.calc.speedBunkerKn).toBe(14);
    expect(keep.calc.waitHoursBunker).toBeGreaterThan(5); // the buffer
    expect(eco.calc.netEur).toBeGreaterThan(keep.calc.netEur);
    expect(eco.calc.verdict).toBe("WORTH_IT");
  });

  it("compares with slow steaming on route, not with rushing and waiting", () => {
    const eco = planBunkerOptions(input()).options[0].calc;
    expect(eco.stayPlan).toBe("JIT");
    expect(eco.speedStayKn).toBeCloseTo(1700 / (1700 / 14 + 24), 6);
    expect(eco.extraFuelT).toBeGreaterThan(0);
  });

  it("leaves out KEEP_SPEED when it is the same as ECO", () => {
    // Just enough slack for the call: ECO has to sail at full speed too.
    const tight = 8 + 20 / 14 + 0.1;
    expect(planBunkerOptions(input({}, tight)).options.map((o) => o.key)).toEqual(["ECO"]);
  });

  it("uses the stem quantity, clamped to the offer", () => {
    expect(planBunkerOptions(input({ stemQtyT: 1000 })).options[0].calc.qtyT).toBe(1000);
    expect(planBunkerOptions(input({ stemQtyT: 300 })).options[0].calc.qtyT).toBe(800);
  });

  it("ECO hurries only on the leg to the port when the slow speed would miss the offer's expiry", () => {
    const validUntil = new Date(NOW.getTime() + 25 * H).toISOString(); // 330 nm: 23.6 h at 14 kn, ~26 h at ECO speed
    const eco = planBunkerOptions(input({ offer: { ...input().offer, validUntil } })).options.find((o) => o.key === "ECO")!;
    expect(eco.calc.offerValidAtArrival).toBe(true);
    expect(eco.calc.speedBunkerKn).toBeGreaterThan(eco.calc.speedAfterBunkerKn!);
    expect(eco.calc.arrivalOk).toBe(true);
  });

  it("the reshaped route runs ship → turn-off → bunker port → back → destination, in time order", () => {
    const eco = planBunkerOptions(input()).options[0];
    expect(eco.waypoints.map((w) => w.kind)).toEqual(["SHIP", "TURN_OFF", "BUNKER_ARRIVE", "BUNKER_DEPART", "REJOIN", "DESTINATION"]);
    const times = eco.waypoints.map((w) => new Date(w.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // ECO uses all the slack: it reaches the destination right at the berth time.
    expect(times[5]).toBeCloseTo(new Date(input().deadline).getTime(), -4);
  });
});

describe("breakEvenUsdPerT", () => {
  it("is the offer price at which the call nets zero", () => {
    const eco = planBunkerOptions(input()).options[0];
    const be = eco.breakEvenUsdPerT!;
    expect(be).toBeGreaterThan(540);
    const atBe = calculateBunker({
      ...bunkerCalcInput(input()),
      bunkerSpeed: "JIT",
      offer: { priceUsdPerT: be, qtyMinT: 800, qtyMaxT: 1200, validUntil: null },
    });
    expect(atBe.netEur).toBeCloseTo(0, 6);
  });

  it("is null when the ship can't make it", () => {
    const late = calculateBunker({ ...bunkerCalcInput(input({}, 0)), bunkerSpeed: "JIT" });
    expect(late.arrivalOk).toBe(false);
    expect(breakEvenUsdPerT(late)).toBeNull();
  });
});
