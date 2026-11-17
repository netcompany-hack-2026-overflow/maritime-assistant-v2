import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentError, looksLikePdf, pdfToText, subjectFromText } from "../documentText.js";
import { mockExtractEmail } from "../../llm/mock.js";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, "../../../../web/public/samples/algeciras-berth-notice.pdf");

describe("documentText", () => {
  it("recognises PDF magic bytes", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.4\n..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("hello"))).toBe(false);
  });

  it("rejects non-PDF uploads with a DocumentError", async () => {
    await expect(pdfToText(Buffer.from("not a pdf"))).rejects.toBeInstanceOf(DocumentError);
  });

  it("extracts text from the sample berth notice and the mock extractor reads it", async () => {
    const text = await pdfToText(readFileSync(SAMPLE));
    expect(text).toContain("MV Ionian Trader");
    const extraction = await mockExtractEmail(text);
    expect(extraction.eventType).toBe("BERTH_DELAY");
    expect(extraction.portUnlocode).toBe("ESALG");
    expect(extraction.delayHours).toBe(18);
  });

  it("uses the first non-empty line as subject, truncated", () => {
    expect(subjectFromText("\n\nBerth notice\nbody", "x.pdf")).toBe("Berth notice");
    expect(subjectFromText("", "x.pdf")).toBe("x.pdf");
    expect(subjectFromText("a".repeat(200), "x.pdf")).toHaveLength(118);
  });
});
