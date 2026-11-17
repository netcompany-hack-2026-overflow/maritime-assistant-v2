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
});
