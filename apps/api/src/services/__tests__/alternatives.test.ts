import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory tables with just enough of Prisma's filtering for the alternatives rules.
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  recs: [] as Row[],
  drafts: [] as Row[],
  audit: [] as Row[],
  voyages: [] as Row[],
  sent: [] as Row[],
}));

vi.mock("../../lib/prisma.js", () => {
  type Where = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const matchRec = (r: Row | undefined, w: Where): boolean => {
    if (!r) return false;
    if (typeof w.id === "string" && r.id !== w.id) return false;
    if (w.id?.in && !w.id.in.includes(r.id)) return false;
    if (w.id?.not && r.id === w.id.not) return false;
    if (w.voyageId && r.voyageId !== w.voyageId) return false;
    if (w.status && r.status !== w.status) return false;
    if (w.rejectReason?.startsWith && !String(r.rejectReason ?? "").startsWith(w.rejectReason.startsWith)) return false;
    if (w.emailDrafts?.none?.status && db.drafts.some((d) => d.recommendationId === r.id && d.status === w.emailDrafts.none.status)) {
      return false;
    }
    return true;
  };
  const matchDraft = (d: Row, w: Where): boolean => {
    if (typeof w.id === "string" && d.id !== w.id) return false;
    if (w.id?.not && d.id === w.id.not) return false;
    if (typeof w.recommendationId === "string" && d.recommendationId !== w.recommendationId) return false;
    if (w.recommendationId?.in && !w.recommendationId.in.includes(d.recommendationId)) return false;
    if (w.status && d.status !== w.status) return false;
    if (w.kind?.not && d.kind === w.kind.not) return false;
    if (w.recommendation && !matchRec(db.recs.find((r) => r.id === d.recommendationId), w.recommendation)) return false;
    return true;
  };
  const withRelations = (r: Row | undefined) =>
    r ? { ...r, voyage: db.voyages.find((v) => v.id === r.voyageId), portEvent: r.portEvent ?? null } : null;
  const client = {
    recommendation: {
      findUnique: async ({ where }: { where: { id: string } }) => withRelations(db.recs.find((r) => r.id === where.id)),
      findMany: async ({ where }: { where: Where }) => db.recs.filter((r) => matchRec(r, where)),
      findFirst: async () => null,
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(db.recs.find((r) => r.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const hit = db.recs.filter((r) => matchRec(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    emailDraft: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const d = db.drafts.find((x) => x.id === where.id);
        return d && include ? { ...d, recommendation: withRelations(db.recs.find((r) => r.id === d.recommendationId)) } : (d ?? null);
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(db.drafts.find((x) => x.id === where.id)!, data, { updatedAt: new Date() }),
      updateMany: async ({ where, data }: { where: Where; data: Row }) => {
        const hit = db.drafts.filter((d) => matchDraft(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      },
    },
    voyage: { findUnique: async ({ where }: { where: { id: string } }) => db.voyages.find((v) => v.id === where.id) ?? null },
    auditLog: {
      create: async ({ data }: { data: Row }) => db.audit.push({ ...data, createdAt: new Date() }),
      findFirst: async ({ where }: { where: Where }) =>
        [...db.audit].reverse().find((a) => a.entity === where.entity && a.entityId === where.entityId && a.action === where.action) ?? null,
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  return { prisma: client };
});

vi.mock("../mailer.js", async () => {
  const actual = await vi.importActual<typeof import("../mailer.js")>("../mailer.js");
  return {
    ...actual,
    sendMail: async (mail: Row) => {
      db.sent.push(mail);
      return { messageId: "<m@test>", deliveredTo: mail.to as string };
    },
  };
});

const { approveRecommendation, undoApproval } = await import("../recommendations.js");
const { sendDraft } = await import("../emailDrafts.js");

const offer = (id: string, port: string, supplier: string, voyageId = "v1") => ({
  id,
  voyageId,
  portEventId: `ev-${id}`,
  actionType: "BUNKER_DETOUR",
  status: "PENDING",
  rejectReason: null,
  decidedAt: null,
  costSavedEur: 50_000,
  bunkerPlan: null,
  portEvent: { eventType: "BUNKER_OFFER", supplier, port: { name: port } },
});
const draftsFor = (recId: string) =>
  ["ACCEPT", "COUNTER", "DECLINE"].map((kind) => ({
    id: `${recId}-${kind}`,
    recommendationId: recId,
    kind,
    optionKey: kind === "DECLINE" ? null : "ECO",
    toAddr: `${recId}@supplier.example`,
    subject: `Re: ${recId}`,
    body: "…",
    status: "DRAFT",
    edited: false,
    sentAt: null,
    messageId: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
const rec = (id: string) => db.recs.find((r) => r.id === id)!;
const draft = (id: string) => db.drafts.find((d) => d.id === id)!;

beforeEach(() => {
  db.voyages = [
    { id: "v1", status: "UNDERWAY" },
    { id: "v2", status: "UNDERWAY" },
  ];
  db.recs = [
    offer("algeciras", "Algeciras", "Strait Bunkering Ltd"),
    offer("ceuta", "Ceuta", "Ceuta Oil Trading"),
    {
      ...offer("slowdown", "Rotterdam", ""),
      actionType: "ADJUST_SPEED",
      portEvent: { eventType: "BERTH_DELAY", supplier: null, port: { name: "Rotterdam" } },
    },
    offer("other-ship", "Singapore", "Lion Fuels", "v2"),
  ];
  db.drafts = [...draftsFor("algeciras"), ...draftsFor("ceuta"), ...draftsFor("other-ship")];
  db.audit = [];
  db.sent = [];
});

describe("one decision per ship", () => {
  it("approving one option closes the ship's other open options, not other ships'", async () => {
    await approveRecommendation("algeciras");
    expect(rec("algeciras").status).toBe("APPROVED");
    for (const id of ["ceuta", "slowdown"]) {
      expect(rec(id)).toMatchObject({
        status: "REJECTED",
        rejectReason: "Δεν επιλέχθηκε: εγκρίθηκε ο ανεφοδιασμός στο Algeciras (Strait Bunkering Ltd) για αυτό το πλοίο",
      });
    }
    expect(rec("other-ship").status).toBe("PENDING");
  });

  it("the closed offers can no longer be accepted or countered, but can still be declined", async () => {
    await approveRecommendation("algeciras");
    expect(draft("ceuta-ACCEPT").status).toBe("SUPERSEDED");
    expect(draft("ceuta-COUNTER").status).toBe("SUPERSEDED");
    expect(draft("ceuta-DECLINE").status).toBe("DRAFT");
    await expect(sendDraft("ceuta-ACCEPT")).rejects.toThrow(/Η προσφορά έκλεισε \(Δεν επιλέχθηκε: εγκρίθηκε ο ανεφοδιασμός στο Algeciras/);
    await sendDraft("ceuta-DECLINE");
    expect(db.sent).toHaveLength(1);
    expect(rec("ceuta").status).toBe("REJECTED");
  });

  it("undo reopens the options it closed, with their replies", async () => {
    await approveRecommendation("algeciras");
    await undoApproval("algeciras");
    expect(rec("algeciras").status).toBe("PENDING");
    expect(rec("ceuta")).toMatchObject({ status: "PENDING", rejectReason: null, decidedAt: null });
    expect(rec("slowdown").status).toBe("PENDING");
    expect(draft("ceuta-ACCEPT").status).toBe("DRAFT");
  });

  it("an option that has been declined by email stays closed after undo", async () => {
    await approveRecommendation("algeciras");
    await sendDraft("ceuta-DECLINE");
    await undoApproval("algeciras");
    expect(rec("ceuta").status).toBe("REJECTED");
    expect(draft("ceuta-ACCEPT").status).toBe("SUPERSEDED");
    expect(rec("slowdown").status).toBe("PENDING");
  });

  it("sending an acceptance email is the same decision: the others close, and undo reopens them", async () => {
    await sendDraft("ceuta-ACCEPT");
    expect(rec("ceuta").status).toBe("APPROVED");
    expect(rec("algeciras").rejectReason).toBe("Δεν επιλέχθηκε: εγκρίθηκε ο ανεφοδιασμός στο Ceuta (Ceuta Oil Trading) για αυτό το πλοίο");
    expect(rec("slowdown").status).toBe("REJECTED");
    await undoApproval("ceuta");
    expect(rec("algeciras").status).toBe("PENDING");
    expect(rec("slowdown").status).toBe("PENDING");
  });

  it("an option that arrives after the decision is a new decision, not blocked", async () => {
    await approveRecommendation("algeciras");
    db.recs.push(offer("late-offer", "Gibraltar", "Rock Marine Fuels"));
    await approveRecommendation("late-offer");
    expect(rec("late-offer").status).toBe("APPROVED");
  });
});

describe("trying to approve a closed option", () => {
  it("says which option was chosen and how to change it", async () => {
    await approveRecommendation("algeciras");
    await expect(approveRecommendation("ceuta")).rejects.toThrow(
      "Δεν επιλέχθηκε: εγκρίθηκε ο ανεφοδιασμός στο Algeciras (Strait Bunkering Ltd) για αυτό το πλοίο. Αναιρέστε εκείνη την έγκριση για να επιλέξετε αυτή."
    );
  });
});
