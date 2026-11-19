import { beforeEach, describe, expect, it, vi } from "vitest";

// Approving a bunker offer records the decision only: the ship's speed and plan stay as they are.
const db = vi.hoisted(() => ({
  rec: null as null | Record<string, unknown>,
  voyage: null as null | Record<string, unknown>,
  voyageUpdates: 0,
  audit: [] as Array<{ action: string }>,
}));

vi.mock("../../lib/prisma.js", () => {
  const client = {
    recommendation: {
      findUnique: async () => db.rec,
      findFirst: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async ({ data }: { data: object }) => Object.assign(db.rec!, data),
    },
    voyage: {
      findUnique: async () => db.voyage,
      update: async () => {
        db.voyageUpdates++;
        return db.voyage;
      },
    },
    portEvent: { findUnique: async () => ({ newBerthTime: null }) },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => db.audit.push(data),
      findFirst: async () => null,
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  return { prisma: client };
});

const { approveRecommendation, undoApproval } = await import("../recommendations.js");

beforeEach(() => {
  db.rec = { id: "r1", voyageId: "v1", portEventId: "ev1", actionType: "BUNKER_DETOUR", status: "PENDING", costSavedEur: 109_000, decidedAt: null };
  db.voyage = { id: "v1", status: "UNDERWAY", speedKn: 12, plannedEta: new Date(), berthTime: null };
  db.voyageUpdates = 0;
  db.audit = [];
});

describe("bunker offer approval", () => {
  it("approve marks it approved and leaves the voyage alone (no berth time needed)", async () => {
    await approveRecommendation("r1");
    expect(db.rec!.status).toBe("APPROVED");
    expect(db.voyageUpdates).toBe(0);
    expect(db.audit.map((a) => a.action)).toEqual(["APPROVED"]);
  });

  it("undo puts it back to pending, still without touching the voyage", async () => {
    await approveRecommendation("r1");
    await undoApproval("r1");
    expect(db.rec!).toMatchObject({ status: "PENDING", decidedAt: null });
    expect(db.voyageUpdates).toBe(0);
    expect(db.audit.map((a) => a.action)).toEqual(["APPROVED", "APPROVAL_UNDONE"]);
  });

  it("can't approve twice", async () => {
    await approveRecommendation("r1");
    await expect(approveRecommendation("r1")).rejects.toThrow(/έχει ήδη εγκριθεί/);
  });
});
