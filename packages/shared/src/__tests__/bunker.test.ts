import { describe, expect, it } from "vitest";
import {
  bunkerVerdictReason,
  calculateBunker,
  nearestPointOnRoute,
  repriceBunker,
  routeAhead,
  type BunkerInput,
} from "../bunker.js";
import { haversineNm } from "../geo.js";

const now = new Date("2026-11-20T00:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

/** Ship already slow-steaming at 11.7 kn to make a berth exactly on time. */
function baseInput(overrides: Partial<BunkerInput> = {}): BunkerInput {
  return {
    remainingNm: 1700,
    offRouteNm: 8,
    alongNm: 320,
    speedKn: 11.7,
    designSpeedKn: 14,
    fuelTPerDayAtDesign: 40,
    auxFuelTPerDay: 3,
    now,
    deadline: hours(1700 / 11.7),
    offer: { priceUsdPerT: 540, qtyMinT: 800, qtyMaxT: 1200, validUntil: hours(120) },
    refPriceEurPerT: 600,
    usdEurRate: 0.92,
    portHours: 8,
    portFeeEur: 5000,
    defaultQtyT: 800,
    co2Factor: 3.114,
    ...overrides,
  };
}

describe("calculateBunker", () => {
  it("near-route cheap offer is worth it and uses the slack by speeding up a little", () => {
    const c = calculateBunker(baseInput());
    expect(c.detourNm).toBe(16);
    expect(c.arrivalOk).toBe(true);
    expect(c.requiredSpeedKn).toBeGreaterThan(11.7);
    expect(c.requiredSpeedKn).toBeLessThan(14);
    expect(c.speedBunkerKn).toBeCloseTo(c.requiredSpeedKn, 9);
    expect(c.qtyT).toBe(1200);
    expect(c.offerPriceEurPerT).toBeCloseTo(496.8, 6);
    expect(c.priceSavingEur).toBeCloseTo(1200 * (600 - 496.8), 6);
    expect(c.extraFuelT).toBeGreaterThan(0);
    expect(c.netEur).toBeCloseTo(c.priceSavingEur - c.extraFuelT * 600 - 5000, 6);
    expect(c.netEur).toBeGreaterThan(50_000);
    expect(c.verdict).toBe("WORTH_IT");
    expect(c.reasons).toEqual([]);
  });

  it("far-off-route offer burns more than it saves", () => {
    const c = calculateBunker(
      baseInput({
        offRouteNm: 480,
        deadline: hours(1000), // plenty of time, so only the money decides
        offer: { priceUsdPerT: 565, qtyMinT: null, qtyMaxT: 500, validUntil: null },
      })
    );
    expect(c.arrivalOk).toBe(true);
    expect(c.netEur).toBeLessThan(0);
    expect(c.verdict).toBe("NOT_WORTH_IT");
    expect(c.reasons).toEqual(["NEGATIVE_NET"]);
  });

  it("offer that expires before the ship gets there", () => {
    const c = calculateBunker(baseInput({ offer: { priceUsdPerT: 540, qtyMinT: null, qtyMaxT: 1000, validUntil: hours(10) } }));
    expect(c.offerValidAtArrival).toBe(false);
    expect(c.reasons).toContain("EXPIRED");
    expect(c.verdict).toBe("NOT_WORTH_IT");
  });

  it("detour that would miss the berth even at design speed", () => {
    // Already at design speed with no slack: any detour makes the ship late.
    const c = calculateBunker(baseInput({ speedKn: 14, deadline: hours(1700 / 14) }));
    expect(c.arrivalOk).toBe(false);
    expect(c.speedBunkerKn).toBe(14);
    expect(c.lateHours).toBeGreaterThan(8);
    expect(c.reasons).toContain("LATE");
    expect(c.verdict).toBe("NOT_WORTH_IT");
  });

  it("zero detour with lots of slack: net is the price saving minus the port fee", () => {
    // Slack covers the port call, so no extra fuel beyond swapping wait-aux for port-aux.
    const c = calculateBunker(baseInput({ offRouteNm: 0, speedKn: 12, deadline: hours(1700 / 12 + 24) }));
    expect(c.detourNm).toBe(0);
    expect(c.speedBunkerKn).toBe(12);
    expect(c.extraFuelT).toBeCloseTo(0, 9);
    expect(c.netEur).toBeCloseTo(c.priceSavingEur - 5000, 6);
  });

  it("uses the default quantity when the offer gives none", () => {
    const c = calculateBunker(baseInput({ offer: { priceUsdPerT: 540, qtyMinT: null, qtyMaxT: null, validUntil: null } }));
    expect(c.qtyT).toBe(800);
    expect(c.qtyAssumed).toBe(true);
  });
});

describe("repriceBunker", () => {
  it("changes only the € side and can flip the verdict", () => {
    const c = calculateBunker(baseInput());
    const r = repriceBunker(c, 480, 0.92); // our own fuel got cheaper than the offer
    expect(r.extraFuelT).toBe(c.extraFuelT);
    expect(r.detourNm).toBe(c.detourNm);
    expect(r.priceSavingEur).toBeLessThan(0);
    expect(r.verdict).toBe("NOT_WORTH_IT");
    expect(repriceBunker(r, 600, 0.92).netEur).toBeCloseTo(c.netEur, 6);
  });
});

describe("route geometry", () => {
  const route = [
    { lat: 36, lon: 2 },
    { lat: 36, lon: -2 },
    { lat: 36, lon: -6 },
  ];

  it("finds the closest point and the distance along the route to it", () => {
    const p = { lat: 36.2, lon: -4 };
    const n = nearestPointOnRoute(route, p)!;
    expect(n.point.lon).toBeCloseTo(-4, 1);
    expect(n.offRouteNm).toBeCloseTo(12, 0);
    expect(n.alongNm).toBeCloseTo(haversineNm(route[0], { lat: 36, lon: -4 }), 0);
  });

  it("a port behind the ship is measured from the ship's position", () => {
    const ahead = routeAhead(route, 100);
    const n = nearestPointOnRoute(ahead, { lat: 36, lon: 2 })!;
    expect(n.alongNm).toBe(0);
    expect(n.offRouteNm).toBeGreaterThan(200);
  });

  it("skips turn-off points whose straight line to the port is blocked (e.g. by land)", () => {
    const p = { lat: 36.2, lon: -4 };
    // Block everything west of lon -3: the nearest open point is at lon -3.
    const blocked = (from: { lon: number }) => from.lon < -3;
    const n = nearestPointOnRoute(route, p, blocked)!;
    expect(n.point.lon).toBeGreaterThanOrEqual(-3);
    expect(n.offRouteNm).toBeGreaterThan(40);
    expect(nearestPointOnRoute(route, p, () => true)).toBeNull();
  });
});

describe("bunkerVerdictReason", () => {
  it("is null when worth it and names every reason otherwise", () => {
    expect(bunkerVerdictReason(calculateBunker(baseInput()), "Rotterdam")).toBeNull();
    const late = calculateBunker(baseInput({ speedKn: 14, deadline: hours(1700 / 14) }));
    expect(bunkerVerdictReason(late, "Rotterdam")).toMatch(/^το πλοίο θα έχανε την πρόσδεση στο Rotterdam κατά \d+ h/);
    const far = calculateBunker(
      baseInput({ offRouteNm: 480, deadline: hours(10), offer: { priceUsdPerT: 565, qtyMinT: null, qtyMaxT: 500, validUntil: hours(5) } })
    );
    expect(bunkerVerdictReason(far, "Rotterdam")).toMatch(/κοστίζει €\d+k περισσότερα.*, το πλοίο θα έχανε.* και η προσφορά λήγει/);
  });
});
