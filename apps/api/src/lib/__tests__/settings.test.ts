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

const { updateFuelPrice } = await import("../settings.js");

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
