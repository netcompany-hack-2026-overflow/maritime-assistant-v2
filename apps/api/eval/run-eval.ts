import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeLlmProviderName, getLlmProvider } from "../src/llm/index.js";
import type { PortEventExtraction } from "@maritime/shared";
import { env } from "../src/lib/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = join(__dirname, "emails");
// One results file per provider, so a real-LLM run never overwrites the mock baseline.
const PROVIDER = activeLlmProviderName();
const RESULTS_PATH = join(__dirname, PROVIDER === "mock" ? "results.md" : `results-${PROVIDER}.md`);

type ExtractionField =
  | "eventType"
  | "portName"
  | "portUnlocode"
  | "vesselNameMentioned"
  | "delayHours"
  | "newBerthTime"
  | "fuelGrade"
  | "priceUsdPerT"
  | "qtyMinT"
  | "qtyMaxT"
  | "validUntil";

const FIELDS: ExtractionField[] = [
  "eventType",
  "portName",
  "portUnlocode",
  "vesselNameMentioned",
  "delayHours",
  "newBerthTime",
  // Bunker-offer fields. Cases written before bunker offers leave them out,
  // which means null.
  "fuelGrade",
  "priceUsdPerT",
  "qtyMinT",
  "qtyMaxT",
  "validUntil",
];

interface EvalCase {
  id: string;
  description: string;
  fromAddr: string;
  subject: string;
  body: string;
  expected: Partial<Pick<PortEventExtraction, ExtractionField>>;
}

function loadCases(): EvalCase[] {
  return readdirSync(EMAILS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(EMAILS_DIR, f), "utf-8")) as EvalCase);
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return String(value);
}

async function main() {
  const cases = loadCases();
  const provider = getLlmProvider();

  const fieldCorrect = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<ExtractionField, number>;
  let exactMatches = 0;

  const rows: string[] = [];

  for (const testCase of cases) {
    const combinedText = `${testCase.subject}\n\n${testCase.body}`;
    const actual = await provider.extractEmail(combinedText);

    let allFieldsMatch = true;
    const fieldResults: string[] = [];

    for (const field of FIELDS) {
      const expectedValue = testCase.expected[field] ?? null;
      const actualValue = actual[field] ?? null;
      const match = expectedValue === actualValue;
      if (match) fieldCorrect[field] += 1;
      else allFieldsMatch = false;
      fieldResults.push(
        `${match ? "✓" : "✗"} ${field}: expected \`${fmt(expectedValue)}\`, got \`${fmt(actualValue)}\``
      );
    }

    if (allFieldsMatch) exactMatches += 1;

    rows.push(
      `### ${testCase.id} ${allFieldsMatch ? "✅" : "❌"}\n\n` +
        `${testCase.description}\n\n` +
        fieldResults.map((r) => `- ${r}`).join("\n")
    );
  }

  const total = cases.length;
  const lines: string[] = [];
  lines.push("# Extraction Eval Results\n");
  lines.push(`Provider under test: \`${PROVIDER}\`${PROVIDER === "mock" ? "" : ` (model \`${env.llmModel}\`)`}`);
  lines.push(`Run at: ${new Date().toISOString()}\n`);

  lines.push("## Summary\n");
  lines.push(`Exact-match emails: **${exactMatches} / ${total}** (${((exactMatches / total) * 100).toFixed(1)}%)\n`);
  lines.push("| Field | Correct | Total | Accuracy |");
  lines.push("|---|---|---|---|");
  for (const field of FIELDS) {
    const correct = fieldCorrect[field];
    lines.push(`| ${field} | ${correct} | ${total} | ${((correct / total) * 100).toFixed(1)}% |`);
  }

  lines.push("\n## Per-email detail\n");
  lines.push(...rows.map((r) => `${r}\n`));

  writeFileSync(RESULTS_PATH, lines.join("\n"));

  console.log(`Exact-match emails: ${exactMatches}/${total}`);
  for (const field of FIELDS) {
    console.log(`  ${field}: ${fieldCorrect[field]}/${total}`);
  }
  console.log(`\nResults written to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
