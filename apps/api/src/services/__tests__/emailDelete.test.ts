import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  emails: [] as Array<{ id: string; subject: string; fromAddr: string }>,
  events: [] as Array<{ id: string; emailId: string }>,
  recs: [] as Array<{ id: string; portEventId: string; status: string }>,
  drafts: [] as Array<{ recommendationId: string; status: string }>,
  audit: [] as unknown[],
}));

vi.mock("../../lib/prisma.js", () => {
  const ids = (w: { in?: string[] } | string | undefined) => (typeof w === "string" ? [w] : (w?.in ?? []));
  const client = {
    email: {
      findUnique: async ({ where }: { where: { id: string } }) => db.emails.find((e) => e.id === where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        db.emails = db.emails.filter((e) => e.id !== where.id);
      },
    },
    portEvent: {
      findMany: async ({ where }: { where: { emailId: string } }) => db.events.filter((e) => e.emailId === where.emailId),
      deleteMany: async ({ where }: { where: { emailId: string } }) => {
        db.events = db.events.filter((e) => e.emailId !== where.emailId);
      },
    },
    recommendation: {
      findMany: async ({ where }: { where: { portEventId: { in: string[] } } }) =>
        db.recs.filter((r) => where.portEventId.in.includes(r.portEventId)),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        db.recs = db.recs.filter((r) => !ids(where.id).includes(r.id));
      },
    },
    emailDraft: {
      count: async ({ where }: { where: { recommendationId: { in: string[] }; status: string } }) =>
        db.drafts.filter((d) => where.recommendationId.in.includes(d.recommendationId) && d.status === where.status).length,
      deleteMany: async ({ where }: { where: { recommendationId: { in: string[] } } }) => {
        db.drafts = db.drafts.filter((d) => !where.recommendationId.in.includes(d.recommendationId));
      },
    },
    outboundEmail: { count: async () => 0, deleteMany: async () => ({ count: 0 }) },
    auditLog: { create: async ({ data }: { data: unknown }) => db.audit.push(data) },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  return { prisma: client };
});

const { deleteEmail } = await import("../emailDelete.js");

beforeEach(() => {
  db.emails = [{ id: "e1", subject: "Bunker offer", fromAddr: "s@x.example" }];
  db.events = [{ id: "ev1", emailId: "e1" }];
  db.recs = [{ id: "r1", portEventId: "ev1", status: "PENDING" }];
  db.drafts = [{ recommendationId: "r1", status: "DRAFT" }];
  db.audit = [];
});

describe("deleteEmail", () => {
  it("removes the email with its port event, pending recommendation and unsent drafts", async () => {
    await deleteEmail("e1");
    expect(db.emails).toEqual([]);
    expect(db.events).toEqual([]);
    expect(db.recs).toEqual([]);
    expect(db.drafts).toEqual([]);
    expect(db.audit).toHaveLength(1);
  });

  it("refuses when the email led to an approved decision", async () => {
    db.recs[0].status = "APPROVED";
    await expect(deleteEmail("e1")).rejects.toThrow(/εγκεκριμένη σύσταση/);
    expect(db.emails).toHaveLength(1);
  });

  it("refuses when a reply has already been sent", async () => {
    db.drafts[0].status = "SENT";
    await expect(deleteEmail("e1")).rejects.toThrow(/Έχει ήδη σταλεί/);
    expect(db.recs).toHaveLength(1);
  });

  it("says so when the email doesn't exist", async () => {
    await expect(deleteEmail("nope")).rejects.toMatchObject({ status: 404 });
  });
});
