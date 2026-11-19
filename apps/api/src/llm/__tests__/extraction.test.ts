import { describe, expect, it } from "vitest";
import { normalizeBerthTime, normalizePortName, parseExtraction } from "../extraction.js";

describe("normalizePortName", () => {
  it("strips 'Port of' and similar wrappers that real models add", () => {
    expect(normalizePortName("Port of Rotterdam")).toBe("Rotterdam");
    expect(normalizePortName("port of singapore")).toBe("singapore");
    expect(normalizePortName("The Port of Antwerp")).toBe("Antwerp");
    expect(normalizePortName("Hamburg Port")).toBe("Hamburg");
    expect(normalizePortName("Λιμάνι του Πειραιά")).toBe("Πειραιά");
  });

  it("leaves plain names, null and 'Port of Spain' alone", () => {
    expect(normalizePortName("Valencia")).toBe("Valencia");
    expect(normalizePortName(null)).toBeNull();
    expect(normalizePortName("Port of Spain")).toBe("Port of Spain");
  });
});

describe("normalizeBerthTime", () => {
  it("canonicalises equivalent ISO strings", () => {
    expect(normalizeBerthTime("2026-11-25T14:00:00Z")).toBe("2026-11-25T14:00:00.000Z");
    expect(normalizeBerthTime("2026-11-25T16:00:00+02:00")).toBe("2026-11-25T14:00:00.000Z");
  });

  it("treats times without a zone as UTC", () => {
    expect(normalizeBerthTime("2026-11-25 14:00")).toBe("2026-11-25T14:00:00.000Z");
    expect(normalizeBerthTime("2026-11-25T14:00:00")).toBe("2026-11-25T14:00:00.000Z");
  });

  it("returns null for null or unparseable input", () => {
    expect(normalizeBerthTime(null)).toBeNull();
    expect(normalizeBerthTime("next Tuesday")).toBeNull();
  });
});

describe("parseExtraction", () => {
  it("turns the gpt-5-mini output from eval-01 into the expected values", () => {
    const out = parseExtraction({
      eventType: "BERTH_DELAY",
      portName: "Port of Rotterdam",
      portUnlocode: "nl rtm",
      vesselNameMentioned: "MV Aegean Star",
      delayHours: 24,
      newBerthTime: "2026-11-25T14:00:00Z",
      confidence: 0.95,
      sourceSpans: [],
    });
    expect(out.portName).toBe("Rotterdam");
    expect(out.portUnlocode).toBe("NLRTM");
    expect(out.newBerthTime).toBe("2026-11-25T14:00:00.000Z");
  });

  it("still rejects output that doesn't match the schema", () => {
    expect(() => parseExtraction({ eventType: "STORM" })).toThrow();
  });

  it("clears every field when there is no event (gpt-5-mini echoed a ship on eval-12)", () => {
    const r = parseExtraction({
      eventType: "NONE", portName: null, portUnlocode: null, vesselNameMentioned: "MV Poseidon Glory",
      delayHours: null, newBerthTime: null, confidence: 0.9,
      sourceSpans: [{ field: "vesselNameMentioned", text: "MV Poseidon Glory" }],
    });
    expect(r.vesselNameMentioned).toBeNull();
    expect(r.sourceSpans).toEqual([]);
  });

  it("normalises bunker-offer fields and drops them on other events", () => {
    const offer = parseExtraction({
      eventType: "BUNKER_OFFER", portName: "Port of Algeciras", portUnlocode: "ES ALG", vesselNameMentioned: null,
      delayHours: null, newBerthTime: null, fuelGrade: "vlsfo", priceUsdPerT: 540, qtyMinT: null, qtyMaxT: 1200,
      validUntil: "2026-11-23 18:00", supplier: " Strait Bunkering Ltd ", confidence: 0.9, sourceSpans: [],
    });
    expect(offer).toMatchObject({
      portName: "Algeciras", portUnlocode: "ESALG", fuelGrade: "VLSFO", qtyMinT: 1200, qtyMaxT: 1200,
      validUntil: "2026-11-23T18:00:00.000Z", supplier: "Strait Bunkering Ltd",
    });
    const delay = parseExtraction({
      eventType: "BERTH_DELAY", portName: "Rotterdam", portUnlocode: "NLRTM", vesselNameMentioned: null,
      delayHours: 24, newBerthTime: null, priceUsdPerT: 540, confidence: 0.9, sourceSpans: [],
    });
    expect(delay.priceUsdPerT).toBeNull();
  });
});

describe("normalizeFuelGrade", async () => {
  const { normalizeFuelGrade } = await import("../extraction.js");
  it("keeps the grade and drops the spec, so offers compare by grade", () => {
    expect(normalizeFuelGrade("VLSFO 0.5%")).toBe("VLSFO");
    expect(normalizeFuelGrade("lsmgo 0.1% (DMA)")).toBe("LSMGO");
    expect(normalizeFuelGrade("Bio-blend B30")).toBe("BIO-BLEND B30");
    expect(normalizeFuelGrade("  ")).toBeNull();
  });
});
