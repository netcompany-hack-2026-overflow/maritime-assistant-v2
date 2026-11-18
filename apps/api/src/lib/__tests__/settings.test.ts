import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Prisma tables updateFuelPrice touches.
const db = vi.hoisted(() => ({
  settings: null as null | { id: number; fuelPriceEurPerT: number; co2Factor: number; updatedAt: Date },
  recs: [] as Array<{ id: string; status: string; fuelSavedT: number; costSavedEur: number; calc: Record<string, number> }>,
  audit: [] as unknown[],
}));

vi.mock("../prisma.js", () => {
  const client = {
    settings: {
      upsert: async ({ create }: { create: { id: number; fuelPriceEurPerT: number; co2Factor: number } }) => {
        db.settings ??= { ...create, updatedAt: new Date() };
        return db.settings;
      },
      update: async ({ data }: { data: { fuelPriceEurPerT: number } }) => {
        db.settings = { ...db.settings!, ...data, updatedAt: new Date() };
        return db.settings;
      },
    },
    recommendation: {
      findMany: async ({ where }: { where: { status: string } }) => db.recs.filter((r) => r.status === where.status),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = db.recs.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    auditLog: { create: async ({ data }: { data: unknown }) => db.audit.push(data) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

const { updateFuelPrice, updatePriceSettings } = await import("../settings.js");
const { calculateBunker } = await import("@maritime/shared");

const rec = (id: string, status: string, fuelSavedT: number) => ({
  id,
  status,
  fuelSavedT,
  costSavedEur: fuelSavedT * 600,
  calc: { fuelSavedT, fuelPriceEurPerT: 600, costSavedEur: fuelSavedT * 600 },
});

describe("updateFuelPrice", () => {
  beforeEach(() => {
    db.settings = { id: 1, fuelPriceEurPerT: 600, co2Factor: 3.114, updatedAt: new Date() };
    db.recs = [rec("p1", "PENDING", 10), rec("a1", "APPROVED", 20), rec("r1", "REJECTED", 5)];
    db.audit = [];
  });

  it("re-prices pending recommendations only", async () => {
    const res = await updateFuelPrice(700);
    expect(res.settings.fuelPriceEurPerT).toBe(700);
    expect(res.repricedRecommendations).toBe(1);

    const [p1, a1, r1] = db.recs;
    expect(p1.costSavedEur).toBe(7000);
    expect(p1.calc.fuelPriceEurPerT).toBe(700);
    expect(a1.costSavedEur).toBe(12000); // unchanged
    expect(r1.costSavedEur).toBe(3000); // unchanged
    expect(db.audit).toHaveLength(1);
  });

  it("does nothing extra when the price is unchanged", async () => {
    const res = await updateFuelPrice(600);
    expect(res.repricedRecommendations).toBe(0);
    expect(db.audit).toHaveLength(0);
  });
});

describe("updatePriceSettings with bunker recommendations", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const bunkerCalc = () =>
    calculateBunker({
      remainingNm: 1700, offRouteNm: 8, alongNm: 300, speedKn: 11.7, designSpeedKn: 14,
      fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3, now,
      deadline: new Date(now.getTime() + (1700 / 11.7) * 3_600_000),
      offer: { priceUsdPerT: 540, qtyMinT: null, qtyMaxT: 1200, validUntil: null },
      refPriceEurPerT: 600, usdEurRate: 0.92, portHours: 8, portFeeEur: 5000, defaultQtyT: 800, co2Factor: 3.114,
    });

  beforeEach(() => {
    db.settings = { id: 1, fuelPriceEurPerT: 600, co2Factor: 3.114, updatedAt: new Date() };
    const b = bunkerCalc();
    db.recs = [
      rec("p1", "PENDING", 10),
      { id: "b1", status: "PENDING", actionType: "BUNKER_DETOUR", fuelSavedT: -b.extraFuelT, costSavedEur: b.netEur, calc: b } as never,
    ];
    db.audit = [];
  });

  it("a new exchange rate re-prices pending bunker offers but not speed changes", async () => {
    const res = await updatePriceSettings({ usdEurRate: 1 });
    expect(res.settings.usdEurRate).toBe(1);
    expect(res.repricedRecommendations).toBe(1);
    const [p1, b1] = db.recs as Array<{ costSavedEur: number; calc: { usdEurRate?: number; netEur?: number } }>;
    expect(p1.costSavedEur).toBe(6000);
    expect(b1.calc.usdEurRate).toBe(1);
    expect(b1.costSavedEur).toBeCloseTo(b1.calc.netEur!, 6);
    expect(b1.costSavedEur).toBeLessThan(bunkerCalc().netEur);
  });

  it("a new fuel price re-prices both kinds", async () => {
    const res = await updatePriceSettings({ fuelPriceEurPerT: 700 });
    expect(res.repricedRecommendations).toBe(2);
  });
});
