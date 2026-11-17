import { describe, expect, it } from "vitest";
import { validateCitations } from "../ask.js";
import type { CitableRow } from "../../llm/types.js";

const rows: CitableRow[] = [
  { table: "voyage", id: "v1", data: {} },
  { table: "recommendation", id: "r1", data: {} },
];

describe("validateCitations", () => {
  it("keeps citations that reference a known table+id pair", () => {
    const result = validateCitations(
      { answer: "MV Aegean Star is underway.", citations: [{ table: "voyage", id: "v1" }] },
      rows
    );
    expect(result.citations).toEqual([{ table: "voyage", id: "v1" }]);
    expect(result.answer).toBe("MV Aegean Star is underway.");
  });

  it("drops citations for table+id pairs not in the provided rows", () => {
    const result = validateCitations(
      {
        answer: "Something.",
        citations: [
          { table: "voyage", id: "v1" },
          { table: "voyage", id: "does-not-exist" },
        ],
      },
      rows
    );
    expect(result.citations).toEqual([{ table: "voyage", id: "v1" }]);
  });

  it("falls back to the can't-answer message when every citation is invalid", () => {
    const result = validateCitations(
      { answer: "Made up answer.", citations: [{ table: "voyage", id: "does-not-exist" }] },
      rows
    );
    expect(result.answer).toBe("I can't answer that from the data.");
    expect(result.citations).toEqual([]);
  });

  it("leaves an uncited answer untouched", () => {
    const result = validateCitations({ answer: "I can't answer that from the data.", citations: [] }, rows);
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe("I can't answer that from the data.");
  });
});
