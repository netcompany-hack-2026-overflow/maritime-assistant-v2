import { describe, expect, it } from "vitest";
import { mockAnswerQuestion, mockExplainRecommendation, mockExtractEmail } from "../mock.js";

describe("mockExtractEmail", () => {
  it("extracts a berth delay with port, vessel, hours, and new berth time", async () => {
    const body = `Berth Delay Notice - MV Aegean Star - Port of Rotterdam

Dear Captain,

This is to inform you that due to congestion at the container terminal, the berth allocated to MV Aegean Star at the Port of Rotterdam (NLRTM) has been delayed by 24 hours. The new berth time is now 2026-11-20 10:00 UTC.

Please adjust your ETA accordingly.`;

    const result = await mockExtractEmail(body);
    expect(result.eventType).toBe("BERTH_DELAY");
    expect(result.portName).toBe("Rotterdam");
    expect(result.portUnlocode).toBe("NLRTM");
    expect(result.vesselNameMentioned).toBe("MV Aegean Star");
    expect(result.delayHours).toBe(24);
    expect(result.newBerthTime).toBe("2026-11-20T10:00:00.000Z");
    expect(result.sourceSpans.length).toBeGreaterThan(0);
  });

  it("extracts a congestion event", async () => {
    const body = `Congestion Alert - Port of Singapore

Please be advised that the Port of Singapore (SGSIN) is currently experiencing severe congestion. Vessels including MV Cycladic Wind should expect a delay of 18 hours before berthing. Updated berth time: 2026-11-22 06:00 UTC.`;

    const result = await mockExtractEmail(body);
    expect(result.eventType).toBe("CONGESTION");
    expect(result.portUnlocode).toBe("SGSIN");
    expect(result.delayHours).toBe(18);
  });

  it("does not let the vessel name swallow the next paragraph's greeting", async () => {
    const body = `Berth Delay - MV Poseidon Glory

Dear Owners,

MV Poseidon Glory departed Piraeus and is proceeding onward. We regret to inform you that upon arrival, the vessel will face a berth delay at the Port of Hamburg (DEHAM): delayed by 30 hours. New berth time: 2026-11-30 05:00 UTC.`;

    const result = await mockExtractEmail(body);
    expect(result.vesselNameMentioned).toBe("MV Poseidon Glory");
  });

  it("returns NONE for an irrelevant email, never inventing data", async () => {
    const body = `Your monthly invoice for hull & machinery insurance coverage is now available. Total due: EUR 12,450.00.`;

    const result = await mockExtractEmail(body);
    expect(result.eventType).toBe("NONE");
    expect(result.portName).toBeNull();
    expect(result.delayHours).toBeNull();
  });
});

describe("mockExplainRecommendation", () => {
  it("produces a rationale mentioning the key numbers", async () => {
    const text = await mockExplainRecommendation({
      vesselName: "MV Aegean Star",
      originPortName: "Piraeus",
      destPortName: "Rotterdam",
      portEventType: "BERTH_DELAY",
      portName: "Rotterdam",
      delayHours: 24,
      currentSpeedKn: 14,
      recommendedSpeedKn: 10.9,
      fuelSavedT: 58.7,
      costSavedEur: 35200,
      co2SavedT: 182.7,
    });
    expect(text).toContain("MV Aegean Star");
    expect(text).toContain("58.7");
  });
});

describe("mockAnswerQuestion", () => {
  it("sums fuel saved across approved recommendations", async () => {
    const result = await mockAnswerQuestion("How much fuel did approved actions save?", [
      { table: "recommendation", id: "r1", data: { status: "APPROVED", fuelSavedT: 58.7 } },
      { table: "recommendation", id: "r2", data: { status: "PENDING", fuelSavedT: 10 } },
    ]);
    expect(result.answer).toContain("58.7");
    expect(result.citations).toEqual([{ table: "recommendation", id: "r1" }]);
  });

  it("falls back when nothing matches", async () => {
    const result = await mockAnswerQuestion("What's the weather like?", []);
    expect(result.answer).toBe("I can't answer that from the data.");
    expect(result.citations).toEqual([]);
  });
});
