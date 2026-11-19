import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Prisma tables updateFuelPrice touches.
const db = vi.hoisted(() => ({
  settings: null as null | { id: number; fuelPriceEurPerT: number; co2Factor: number; updatedAt: Date },
  recs: [] as Array<{ id: string; status: string; fuelSavedT: number; costSavedEur: number; calc: Record<string, number> }>,
  audit: [] as unknown[],
  drafts: [] as Array<Record<string, unknown>>,
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
    emailDraft: {
      findMany: async ({ where }: { where: { recommendationId: string } }) =>
        db.drafts.filter((d) => d.recommendationId === where.recommendationId),
      deleteMany: async ({ where }: { where: { recommendationId: string } }) => {
        db.drafts = db.drafts.filter((d) => !(d.recommendationId === where.recommendationId && d.status === "DRAFT" && !d.edited));
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        for (const d of data) db.drafts.push({ ...d, status: "DRAFT", edited: false });
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

const { updateFuelPrice, updatePriceSettings } = await import("../settings.js");
const { calculateBunker, planBunkerOptions } = await import("@maritime/shared");

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

describe("updatePriceSettings with bunker options", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  const input = {
    now: now.toISOString(),
    deadline: new Date(now.getTime() + (1700 / 14 + 24) * 3_600_000).toISOString(),
    remainingNm: 1700, offRouteNm: 10, alongNm: 320,
    shipPosition: { lat: 37, lon: 0 }, turnOff: { lat: 36, lon: -5.3 }, bunkerPort: { lat: 36.1, lon: -5.4 }, destination: { lat: 52, lon: 4 },
    vessel: { speedKn: 14, designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
    offer: { priceUsdPerT: 640, qtyMinT: null, qtyMaxT: null, validUntil: null },
    stemQtyT: 800, refPriceEurPerT: 600, usdEurRate: 0.92, stdPortHours: 8, stdQtyT: 800, pumpRateTPerH: 250,
    portFeeEur: 5000, co2Factor: 3.114, delays: [], toleranceHours: 0.5,
  };
  const context = {
    supplierName: "Strait Bunkering Ltd", supplierAddr: "s@x.example", offerSubject: "Offer", vesselName: "MV Aegean Star",
    vesselImo: "9000001", portName: "Algeciras", portUnlocode: "ESALG", fuelGrade: "VLSFO", priceUsdPerT: 640, validUntil: null, senderName: "Ops",
  };

  beforeEach(() => {
    db.settings = { id: 1, fuelPriceEurPerT: 600, co2Factor: 3.114, updatedAt: new Date() };
    const plan = { version: 1, input, ...planBunkerOptions(input), route: { before: [], after: [] }, context };
    const best = plan.options[0].calc;
    db.recs = [{ id: "b1", status: "PENDING", actionType: "BUNKER_DETOUR", fuelSavedT: -best.extraFuelT, costSavedEur: best.netEur, calc: best, bunkerPlan: plan } as never];
    db.drafts = [
      { recommendationId: "b1", kind: "COUNTER", optionKey: "ECO", status: "DRAFT", edited: false, body: "old counter" },
      { recommendationId: "b1", kind: "DECLINE", optionKey: null, status: "DRAFT", edited: true, body: "my own words" },
    ];
    db.audit = [];
  });

  it("re-prices every option and rewrites untouched drafts, keeping edited ones", async () => {
    const before = (db.recs[0] as unknown as { costSavedEur: number }).costSavedEur;
    expect(before).toBeLessThan(0); // USD 640/t is dearer than our €600/t
    await updatePriceSettings({ fuelPriceEurPerT: 700 });
    const b1 = db.recs[0] as unknown as { costSavedEur: number; calc: { netEur: number }; bunkerPlan: { options: Array<{ calc: { netEur: number; refPriceEurPerT: number } }> } };
    expect(b1.bunkerPlan.options.every((o) => o.calc.refPriceEurPerT === 700)).toBe(true);
    expect(b1.costSavedEur).toBe(b1.bunkerPlan.options[0].calc.netEur);
    expect(b1.costSavedEur).toBeGreaterThan(0);
    // Now worth it: acceptances instead of a counter; the edited decline is kept as written.
    expect(db.drafts.map((d) => `${d.kind}:${d.edited ? "edited" : "new"}`).sort()).toEqual(["ACCEPT:new", "ACCEPT:new", "DECLINE:edited"]);
    expect(db.drafts.find((d) => d.kind === "DECLINE")!.body).toBe("my own words");
  });
});

