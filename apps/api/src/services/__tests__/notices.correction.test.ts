import { describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../../lib/prisma.js", () => ({
  prisma: { outboundEmail: { create: async ({ data }: { data: Record<string, unknown> }) => (created.push(data), data) } },
}));

const { draftCorrectionNotice } = await import("../notices.js");

describe("draftCorrectionNotice", () => {
  it("drafts a correction to the same people with the restored speed and ETA", async () => {
    await draftCorrectionNotice({
      recommendationId: "r1",
      sent: {
        toAddrs: "chartering@example.com",
        ccAddrs: "agent@example.com",
        subject: "MV Aegean Star – revised ETA Rotterdam",
        sentAt: new Date("2026-11-20T08:00:00Z"),
      },
      vesselName: "MV Aegean Star",
      imo: "9000001",
      destPortName: "Rotterdam",
      restoredSpeedKn: 14,
      restoredEta: new Date("2026-11-22T06:30:00Z"),
    });
    expect(created[0]).toMatchObject({
      recommendationId: "r1",
      toAddrs: "chartering@example.com",
      ccAddrs: "agent@example.com",
      subject: "Correction – MV Aegean Star – revised ETA Rotterdam",
      status: "DRAFT",
    });
    const body = String(created[0].body);
    expect(body).toContain("Please disregard our notice of 2026-11-20 08:00 UTC");
    expect(body).toContain("continues at 14.0 kn. ETA Rotterdam: 2026-11-22 06:30 UTC");
  });
});
