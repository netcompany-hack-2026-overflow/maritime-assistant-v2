import { describe, expect, it } from "vitest";
import { mockDraftNotice, mockExtractCharterParty, parseCharterPartyTerms } from "../../llm/charterParty.js";
import { AEGEAN_STAR_CP, CYCLADIC_WIND_CP } from "../../demo/charterParties.js";
import { headCurrentComponent, mockSample, seaStateFactor, summarise, valueAt } from "../weather.js";
import { parseAisMessage } from "../ais.js";
import { relativeFuel } from "../weatherRoute.js";

describe("charter party extraction (offline)", () => {
  it("reads laytime, NOR, WIBON, demurrage/despatch and the JIT clause", async () => {
    const t = await mockExtractCharterParty(AEGEAN_STAR_CP);
    expect(t.reference).toContain("GENCON 1994");
    expect(t.chartererName).toBe("North Sea Grain Trading B.V.");
    expect(t.chartererEmail).toBe("chartering@northseagrain.example");
    expect(t.agentEmail).toBe("ops@rtm-agency.example");
    expect(t.vesselName).toBe("MV Aegean Star");
    expect(t.laytimeHours).toBe(72);
    expect(t.laytimeBasis).toBe("SHINC");
    expect(t.norNoticeHours).toBe(6);
    expect(t.waitingTimeCounts).toBe(true);
    expect(t.demurrageRatePerDay).toBe(18500);
    expect(t.despatchRatePerDay).toBe(9250);
    expect(t.currency).toBe("USD");
    expect(t.jitClause.present).toBe(true);
    expect(t.jitClause.name).toBe("Clause 32 — Just In Time Arrival");
    expect(t.jitClause.speedReductionPermitted).toBe(true);
    expect(t.jitClause.requiresChartererInstruction).toBe(true);
    for (const s of t.sourceSpans) expect(AEGEAN_STAR_CP).toContain(s.text);
  });

  it("finds no JIT clause where there is none", async () => {
    const t = await mockExtractCharterParty(CYCLADIC_WIND_CP);
    expect(t.laytimeHours).toBe(96);
    expect(t.norNoticeHours).toBe(12);
    expect(t.waitingTimeCounts).toBe(true);
    expect(t.demurrageRatePerDay).toBe(15000);
    expect(t.despatchRatePerDay).toBe(0);
    expect(t.jitClause.present).toBe(false);
  });

  it("reads the war risks clause and who pays the additional premium", async () => {
    const t = await mockExtractCharterParty(CYCLADIC_WIND_CP);
    expect(t.warRisksClause.present).toBe(true);
    expect(t.warRisksClause.name).toBe("Clause 34 — War Risks Clause (VOYWAR 2013)");
    expect(t.warRisksClause.additionalPremiumForCharterers).toBe(true);
    expect(t.warRisksClause.crewBonusForCharterers).toBe(true);
    for (const s of t.sourceSpans) expect(CYCLADIC_WIND_CP).toContain(s.text);
    const aegean = await mockExtractCharterParty(AEGEAN_STAR_CP);
    expect(aegean.warRisksClause.present).toBe(false);
    expect(aegean.warRisksClause.additionalPremiumForCharterers).toBeNull();
  });

  it("tolerates a model leaving keys out", () => {
    const t = parseCharterPartyTerms({ laytimeHours: 48, currency: "usd", confidence: 0.7 });
    expect(t.laytimeHours).toBe(48);
    expect(t.currency).toBe("USD");
    expect(t.jitClause.present).toBe(false);
    expect(t.warRisksClause.present).toBe(false);
    expect(t.demurrageRatePerDay).toBeNull();
  });
});

describe("notice draft (offline)", () => {
  it("states the new ETA, the reason and the CP terms", async () => {
    const d = await mockDraftNotice({
      vesselName: "MV Aegean Star",
      imo: "9000001",
      originPortName: "Piraeus",
      destPortName: "Rotterdam",
      portEventType: "BERTH_DELAY",
      delayHours: 24,
      reportedBy: "ops@rtm-agency.example",
      previousEtaUtc: "2026-11-21T10:00:00.000Z",
      newEtaUtc: "2026-11-22T10:00:00.000Z",
      berthTimeUtc: "2026-11-22T10:00:00.000Z",
      scenarioLabel: "B (Just-in-time)",
      scenarioDescription: "Slow to 10.7 kn on the planned route.",
      newSpeedKn: 10.7,
      previousSpeedKn: 14,
      fuelSavedT: 57.1,
      co2SavedT: 177.8,
      weather: "waves 1.2 m mean / 2.0 m max, no net current",
      cp: {
        reference: "GENCON 1994 (Ref. AS-2611-RTM)",
        chartererName: "North Sea Grain Trading B.V.",
        laytimeHours: 72,
        laytimeBasis: "SHINC",
        norNoticeHours: 6,
        waitingTimeCounts: true,
        demurrageRatePerDay: 18500,
        currency: "USD",
        jitClauseName: "Clause 32 — Just In Time Arrival",
        jitCoverage: "Covered on the charterers' instruction.",
        jitStatus: "NEEDS_INSTRUCTION",
        laytimeUsedHours: 58,
        withinLaytime: true,
        demurrageAvoided: 4625,
      },
    });
    expect(d.subject).toContain("2026-11-22 10:00 UTC");
    expect(d.body).toContain("Dear North Sea Grain Trading B.V.");
    expect(d.body).toContain("berth delay of 24 h at Rotterdam");
    expect(d.body).toContain("72 running hours SHINC");
    expect(d.body).toContain("USD 18,500 per day");
    expect(d.body).toContain("USD 4,625 of demurrage");
    expect(d.body).toContain("Speed adjusted under Clause 32 — Just In Time Arrival. Please confirm");
  });
});

describe("weather maths", () => {
  it("turns waves into a fuel factor and currents into a head component", () => {
    expect(seaStateFactor(0)).toBe(1);
    expect(seaStateFactor(3)).toBeCloseTo(1.108);
    expect(seaStateFactor(20)).toBe(1.35);
    // Current flowing towards 180° against a ship heading 0° is fully adverse.
    expect(headCurrentComponent(1, 180, 0)).toBeCloseTo(1);
    expect(headCurrentComponent(1, 0, 0)).toBeCloseTo(-1);
    expect(headCurrentComponent(1, 90, 0)).toBeCloseTo(0);
  });

  it("reads the hourly value nearest the passage time", () => {
    const times = ["2026-11-18T00:00", "2026-11-18T01:00", "2026-11-18T02:00"];
    expect(valueAt(times, [1, 2, 3], new Date("2026-11-18T01:20:00Z"))).toBe(2);
    expect(valueAt(times, [1, 2, 3], new Date("2026-11-25T00:00:00Z"))).toBe(3);
    expect(valueAt(times, [1, null, 3], new Date("2026-11-18T01:00:00Z"))).toBeNull();
  });

  it("summarises samples, and the mock is deterministic", () => {
    const at = new Date("2026-11-18T00:00:00Z");
    const a = mockSample({ lat: 45, lon: -9 }, 0, at);
    expect(mockSample({ lat: 45.5, lon: -9.5 }, 0, at)).toEqual({ ...a, lat: 45.5, lon: -9.5 });
    const w = summarise([a, { ...a, waveM: null }], "mock");
    expect(w.meanWaveM).toBe(a.waveM);
    expect(w.source).toBe("mock");
    expect(w.seaStateFuelFactor).toBeGreaterThanOrEqual(1);
  });

  it("scores longer or rougher routes as more fuel", () => {
    const calm = { headCurrentKn: 0, seaStateFuelFactor: 1 };
    expect(relativeFuel(1100, 100, calm)).toBeGreaterThan(relativeFuel(1000, 100, calm));
    expect(relativeFuel(1000, 100, { headCurrentKn: 0, seaStateFuelFactor: 1.2 })).toBeGreaterThan(relativeFuel(1000, 100, calm));
  });
});

describe("AIS parsing", () => {
  it("reads an aisstream.io PositionReport", () => {
    const r = parseAisMessage({
      MessageType: "PositionReport",
      MetaData: { MMSI: 240123000, ShipName: "TEST", latitude: 37.9, longitude: 23.6, time_utc: "2026-11-18 10:15:03.123456 +0000 UTC" },
      Message: { PositionReport: { Latitude: 37.9, Longitude: 23.6, Sog: 12.3, Cog: 271.5, TrueHeading: 270, UserID: 240123000 } },
    });
    expect(r).toMatchObject({ mmsi: "240123000", lat: 37.9, lon: 23.6, sogKn: 12.3, cogDeg: 271.5 });
    expect(r!.at.toISOString()).toBe("2026-11-18T10:15:03.123Z");
  });

  it("ignores other messages and 'not available' positions", () => {
    expect(parseAisMessage({ MessageType: "ShipStaticData" })).toBeNull();
    expect(
      parseAisMessage({ MessageType: "PositionReport", MetaData: { MMSI: 1 }, Message: { PositionReport: { Latitude: 91, Longitude: 181 } } })
    ).toBeNull();
  });
});
