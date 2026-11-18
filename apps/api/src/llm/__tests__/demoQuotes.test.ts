import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mockExtractEmail } from "../mock.js";
import { parseExtraction } from "../extraction.js";

interface DemoEmail {
  id: string;
  subject: string;
  body: string;
  expected: Record<string, unknown>;
}

const demo = JSON.parse(
  readFileSync(new URL("../../../prisma/mock_demo_data.json", import.meta.url), "utf-8")
) as { emails: DemoEmail[] };

describe("demo supplier quotes (prisma/mock_demo_data.json) through the offline parser", () => {
  it("has the four scenarios", () => {
    expect(demo.emails.map((e) => e.id)).toEqual(["trap-lowball", "balanced", "urgent-expiring", "messy-two-grades"]);
  });

  for (const email of demo.emails) {
    it(`${email.id}: extracts every expected field`, async () => {
      const got = (await mockExtractEmail(`${email.subject}\n\n${email.body}`)) as Record<string, unknown>;
      for (const [field, value] of Object.entries(email.expected)) {
        expect({ field, value: got[field] }).toEqual({ field, value });
      }
    });

    it(`${email.id}: every source span is copied from the email`, async () => {
      const text = `${email.subject}\n\n${email.body}`;
      const got = await mockExtractEmail(text);
      for (const span of got.sourceSpans) expect(text).toContain(span.text);
    });

    it(`${email.id}: survives the same normalisation real-LLM output gets`, async () => {
      const got = await mockExtractEmail(`${email.subject}\n\n${email.body}`);
      const parsed = parseExtraction(got) as Record<string, unknown>;
      expect(parsed.priceUsdPerT).toBe(email.expected.priceUsdPerT);
      expect(parsed.offerLines).toEqual(email.expected.offerLines);
      expect(parsed.paymentDays).toBe(email.expected.paymentDays);
    });
  }
});
