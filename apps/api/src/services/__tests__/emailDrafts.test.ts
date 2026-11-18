import { beforeEach, describe, expect, it, vi } from "vitest";
import { planBunkerOptions, type BunkerPlan, type BunkerPlanInput } from "@maritime/shared";

// In-memory stand-in for the tables sendDraft/updateDraft touch.
const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  rec: null as null | Record<string, unknown>,
  audit: [] as Array<Record<string, unknown>>,
  sent: [] as Array<{ to: string; subject: string; text: string }>,
  mailerFails: null as null | { status: number; message: string },
}));

vi.mock("../../lib/prisma.js", () => {
  const withRec = (d: Record<string, unknown> | undefined) => (d ? { ...d, recommendation: db.rec } : null);
  const client = {
    emailDraft: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const d = db.drafts.find((x) => x.id === where.id);
        return include ? withRec(d) : (d ?? null);
      },
      findFirst: async () => null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(db.drafts.find((x) => x.id === where.id)!, data, { updatedAt: new Date() }),
      updateMany: async ({ where, data }: { where: { recommendationId: string; status: string; id: { not: string } }; data: object }) => {
        for (const d of db.drafts) {
          if (d.recommendationId === where.recommendationId && d.status === where.status && d.id !== where.id.not) Object.assign(d, data);
        }
      },
    },
    recommendation: {
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(db.rec!, data),
    },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => db.audit.push(data) },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  return { prisma: client };
});

vi.mock("../mailer.js", async () => {
  const actual = await vi.importActual<typeof import("../mailer.js")>("../mailer.js");
  return {
    ...actual,
    sendMail: async (mail: { to: string; subject: string; text: string }) => {
      if (db.mailerFails) throw new actual.MailerError(db.mailerFails.status, db.mailerFails.message);
      db.sent.push(mail);
      return { messageId: "<m1@test>", deliveredTo: mail.to };
    },
  };
});

const { sendDraft, updateDraft } = await import("../emailDrafts.js");

const H = 3_600_000;
const now = new Date();
const planInput: BunkerPlanInput = {
  now: now.toISOString(),
  deadline: new Date(now.getTime() + (1700 / 14 + 24) * H).toISOString(),
  remainingNm: 1700, offRouteNm: 10, alongNm: 320,
  shipPosition: { lat: 37, lon: 0 }, turnOff: { lat: 36, lon: -5.3 }, bunkerPort: { lat: 36.1, lon: -5.4 }, destination: { lat: 52, lon: 4 },
  vessel: { speedKn: 14, designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
  offer: { priceUsdPerT: 531, qtyMinT: 750, qtyMaxT: 1000, validUntil: null },
  stemQtyT: 800, refPriceEurPerT: 600, usdEurRate: 0.92, stdPortHours: 8, stdQtyT: 800, pumpRateTPerH: 250,
  portFeeEur: 5000, co2Factor: 3.114, delays: [], toleranceHours: 0.5,
};
const plan = { ...planBunkerOptions(planInput), input: planInput } as unknown as BunkerPlan;
const keep = plan.options.find((o) => o.key === "KEEP_SPEED")!;

const draft = (id: string, kind: string, optionKey: string | null) => ({
  id, recommendationId: "r1", kind, optionKey, toAddr: "trading@strait-bunkering.example",
  subject: `Re: offer (${id})`, body: `Body ${id}`, status: "DRAFT", edited: false,
  sentAt: null, messageId: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
});

beforeEach(() => {
  db.rec = { id: "r1", status: "PENDING", bunkerPlan: plan, voyage: { status: "UNDERWAY" }, costSavedEur: plan.options[0].calc.netEur };
  db.drafts = [draft("d-eco", "ACCEPT", "ECO"), draft("d-keep", "ACCEPT", "KEEP_SPEED"), draft("d-counter", "COUNTER", "ECO"), draft("d-no", "DECLINE", null)];
  db.audit = [];
  db.sent = [];
  db.mailerFails = null;
});

describe("sendDraft", () => {
  it("sending an acceptance approves the offer with that option's numbers and supersedes the rest", async () => {
    const res = await sendDraft("d-keep");
    expect(db.sent).toEqual([{ to: "trading@strait-bunkering.example", subject: "Re: offer (d-keep)", text: "Body d-keep" }]);
    expect(res.draft).toMatchObject({ status: "SENT", messageId: "<m1@test>" });
    expect(db.drafts.filter((d) => d.status === "SUPERSEDED").map((d) => d.id)).toEqual(["d-eco", "d-counter", "d-no"]);
    expect(db.rec).toMatchObject({
      status: "APPROVED",
      chosenOption: "KEEP_SPEED",
      recommendedSpeedKn: keep.calc.speedBunkerKn,
      costSavedEur: keep.calc.netEur,
    });
    expect(db.audit[0]).toMatchObject({ entity: "emailDraft", action: "SENT" });
  });

  it("sending the decline rejects the offer", async () => {
    await sendDraft("d-no");
    expect(db.rec).toMatchObject({ status: "REJECTED", rejectReason: "Declined by email to trading@strait-bunkering.example" });
  });

  it("a counter-offer leaves it pending, waiting for the supplier", async () => {
    await sendDraft("d-counter");
    expect(db.rec!.status).toBe("PENDING");
  });

  it("only one reply per offer", async () => {
    await sendDraft("d-eco");
    await expect(sendDraft("d-eco")).rejects.toThrow(/already sent/);
    await expect(sendDraft("d-no")).rejects.toThrow(/Another reply/);
    expect(db.sent).toHaveLength(1);
  });

  it("won't accept for a voyage that's no longer underway (and sends nothing)", async () => {
    db.rec!.voyage = { status: "ARRIVED" };
    await expect(sendDraft("d-eco")).rejects.toThrow(/no longer underway/);
    expect(db.sent).toHaveLength(0);
  });

  it("when the provider fails, nothing changes except the error shown on the draft", async () => {
    db.mailerFails = { status: 503, message: "The email provider isn't set up. Fill in SMTP_HOST, MAIL_FROM in .env and restart the API." };
    await expect(sendDraft("d-eco")).rejects.toMatchObject({ status: 503 });
    expect(db.drafts[0]).toMatchObject({ status: "DRAFT", lastError: expect.stringMatching(/SMTP_HOST/) });
    expect(db.rec!.status).toBe("PENDING");
  });
});

describe("updateDraft", () => {
  it("saves the edit and marks the draft as edited", async () => {
    const d = await updateDraft("d-eco", { body: "Edited text" });
    expect(d).toMatchObject({ body: "Edited text", edited: true });
  });

  it("can't edit a sent email", async () => {
    await sendDraft("d-eco");
    await expect(updateDraft("d-eco", { body: "x" })).rejects.toThrow(/already sent/);
  });
});
