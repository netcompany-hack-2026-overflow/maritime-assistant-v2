import { z } from "zod";
import { charterPartyTermsSchema, type CharterPartyTerms } from "@maritime/shared";
import type { NoticeDraft, NoticeFacts } from "./types.js";

/** System prompt for the real-LLM charter-party extraction. */
export const CHARTER_PARTY_SYSTEM_PROMPT =
  "You read voyage charter parties (GENCON, ASBATANKVOY, etc.) and extract the terms that decide " +
  "laytime, demurrage and whether the vessel may slow down for a just-in-time arrival. " +
  "Reply with ONLY a JSON object (no markdown fences) with exactly these keys: " +
  '{"reference":string|null,"chartererName":string|null,"chartererEmail":string|null,' +
  '"agentEmail":string|null,"vesselName":string|null,"laytimeHours":number|null,' +
  '"laytimeBasis":string|null,"norNoticeHours":number|null,"waitingTimeCounts":boolean|null,' +
  '"demurrageRatePerDay":number|null,"despatchRatePerDay":number|null,"currency":string|null,' +
  '"jitClause":{"present":boolean,"name":string|null,"text":string|null,' +
  '"speedReductionPermitted":boolean|null,"requiresChartererInstruction":boolean|null},' +
  '"confidence":number (0-1),"sourceSpans":[{"field":string,"text":string}]}. ' +
  "laytimeHours is the laytime allowed at the DISCHARGE port in hours (days × 24). " +
  "norNoticeHours is the turn time after Notice of Readiness before laytime counts. " +
  "waitingTimeCounts is true for WIBON / 'berth or no berth' / 'time lost waiting for berth to count'. " +
  "despatchRatePerDay: 'half demurrage' means half the demurrage rate; 'free despatch' means 0. " +
  "currency is ISO 4217 (USD, EUR). jitClause covers Just-In-Time Arrival or Virtual Arrival clauses; " +
  "jitClause.text is the clause wording copied exactly. Use null for anything the text does not state; " +
  "never guess. Each sourceSpans[].text must be an exact substring of the charter party.";

const EMPTY_TERMS: CharterPartyTerms = {
  reference: null,
  chartererName: null,
  chartererEmail: null,
  agentEmail: null,
  vesselName: null,
  laytimeHours: null,
  laytimeBasis: null,
  norNoticeHours: null,
  waitingTimeCounts: null,
  demurrageRatePerDay: null,
  despatchRatePerDay: null,
  currency: null,
  jitClause: { present: false, name: null, text: null, speedReductionPermitted: null, requiresChartererInstruction: null },
  confidence: 0.5,
  sourceSpans: [],
};

/** Validate a model's JSON; keys it left out become null rather than failing the upload. */
export function parseCharterPartyTerms(raw: unknown): CharterPartyTerms {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const jit = (r.jitClause && typeof r.jitClause === "object" ? r.jitClause : {}) as Record<string, unknown>;
  const merged = { ...EMPTY_TERMS, ...r, jitClause: { ...EMPTY_TERMS.jitClause, ...jit } };
  if (typeof merged.currency === "string") merged.currency = merged.currency.trim().toUpperCase().replace("$", "USD");
  return charterPartyTermsSchema.parse(merged);
}

export const NOTICE_SYSTEM_PROMPT =
  "You write the email a ship operator sends to the charterers (To) and the port agent (Cc) after " +
  "approving a speed or route change. Plain, professional shipping English, under 220 words. " +
  "State the new ETA, the reason, the speed/route change and the charter-party terms given " +
  "(laytime, NOR, demurrage, JIT clause). Restate only the facts and numbers provided; never invent " +
  "terms, numbers or names. Times are UTC. Ask the charterers to confirm and the agent to update berth " +
  'planning. Reply with ONLY JSON: {"subject":string,"body":string}.';

export const noticeDraftSchema = z.object({ subject: z.string().min(1), body: z.string().min(1) });

// ---------- offline (mock) extraction ----------

type Span = { field: string; text: string };

const MONEY = /(USD|EUR|US\$|€|\$)\s?([\d,]+(?:\.\d+)?)/i;

function currencyCode(sym: string): string {
  const s = sym.toUpperCase();
  return s === "€" || s === "EUR" ? "EUR" : "USD";
}

function lineMatching(text: string, re: RegExp): string | null {
  return text.split("\n").find((l) => re.test(l))?.trim() ?? null;
}

/** The clause that starts at `index`: up to a blank line or the next "Clause N" heading. */
function paragraphFrom(text: string, index: number): string {
  const rest = text.slice(index);
  const end = rest.search(/\n\s*\n|\n\s*(?:Clause|Cl\.)\s*\d+/i);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * Deterministic regex extraction of charter-party terms. Handles the demo CPs
 * (seeded and apps/web/public/samples) and common GENCON-style wording; a real
 * LLM handles everything else.
 */
export async function mockExtractCharterParty(text: string): Promise<CharterPartyTerms> {
  const spans: Span[] = [];
  const span = (field: string, t: string | null | undefined) => {
    if (t) spans.push({ field, text: t });
  };

  const refLine = lineMatching(text, /charter\s*party\s+dated|GENCON|ASBATANKVOY/i);
  span("reference", refLine);

  const chartererLine = lineMatching(text, /^\s*(?:\d+\.\s*)?Charterers?\s*:/i);
  const chartererName = chartererLine
    ? chartererLine.replace(/^\s*(?:\d+\.\s*)?Charterers?\s*:\s*/i, "").split(/[,(]/)[0].trim() || null
    : null;
  const chartererEmail = chartererLine?.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
  span("chartererName", chartererName);
  span("chartererEmail", chartererEmail);

  const agentLine = lineMatching(text, /^\s*(?:\d+\.\s*)?Agents?\b[^:\n]*:/i);
  const agentEmail = agentLine?.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null;
  span("agentEmail", agentEmail);

  const vessel = text.match(/\bMV[^\S\n]+[A-Z][\p{L}]+(?:[^\S\n]+[A-Z][\p{L}]+)*/u)?.[0] ?? null;
  span("vesselName", vessel);

  const laytime = text.match(/laytime[^\n.]*?(\d+(?:\.\d+)?)\s*(?:running\s+|weather\s+working\s+)?(hours|days)/i);
  const laytimeHours = laytime ? Number(laytime[1]) * (laytime[2].toLowerCase() === "days" ? 24 : 1) : null;
  span("laytimeHours", laytime?.[0]);

  const basis = text.match(/\b(SHINC|SHEX|SSHEX|FHINC|FHEX)\b/);
  span("laytimeBasis", basis?.[0]);

  const nor =
    text.match(/(\d+(?:\.\d+)?)\s*hours?\s+after\s+notice\s+of\s+readiness/i) ??
    text.match(/notice\s+of\s+readiness[^.\n]*?(\d+(?:\.\d+)?)\s*hours?/i) ??
    text.match(/turn\s*time\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*hours?/i);
  span("norNoticeHours", nor?.[0]);

  const waitYes = text.match(/\bWIBON\b|berth\s+or\s+no\s+berth|whether\s+in\s+berth\s+or\s+not|time\s+lost\s+(?:in\s+)?waiting\s+for\s+(?:a\s+)?berth\s+to\s+count/i);
  const waitNo = text.match(/waiting\s+for\s+(?:a\s+)?berth\s+not\s+to\s+count|time\s+waiting\s+for\s+berth\s+shall\s+not\s+count/i);
  span("waitingTimeCounts", (waitNo ?? waitYes)?.[0]);

  const demLine = lineMatching(text, /^\s*(?:\d+\.\s*)?Demurrage\b/i) ?? lineMatching(text, /demurrage[^\n]*(USD|EUR|US\$|€|\$)\s?\d/i);
  const dem = demLine?.match(MONEY) ?? null;
  const demurrageRatePerDay = dem ? Number(dem[2].replace(/,/g, "")) : null;
  span("demurrageRatePerDay", dem?.[0]);

  const desLine = lineMatching(text, /^\s*(?:\d+\.\s*)?Despatch\b/i);
  let despatchRatePerDay: number | null = null;
  if (desLine) {
    const m = desLine.match(MONEY);
    if (/free\s+despatch|no\s+despatch/i.test(desLine)) despatchRatePerDay = 0;
    else if (m) despatchRatePerDay = Number(m[2].replace(/,/g, ""));
    else if (/half\s+demurrage/i.test(desLine) && demurrageRatePerDay != null) despatchRatePerDay = demurrageRatePerDay / 2;
    span("despatchRatePerDay", desLine);
  }

  const jitHead = text.match(/^[^\n]*(?:just[\s-]+in[\s-]+time\s+arrival|virtual\s+arrival)[^\n]*$/im);
  let jitClause: CharterPartyTerms["jitClause"] = {
    present: false,
    name: null,
    text: null,
    speedReductionPermitted: null,
    requiresChartererInstruction: null,
  };
  if (jitHead && jitHead.index !== undefined) {
    const clause = paragraphFrom(text, jitHead.index);
    jitClause = {
      present: true,
      name: jitHead[0].trim().replace(/[\s—–:-]+$/, ""),
      text: clause,
      speedReductionPermitted: /(?:adjust|reduce)\s+(?:the\s+vessel'?s\s+)?speed/i.test(clause) ? true : null,
      requiresChartererInstruction: /charterers?\s+(?:may|shall|to)\s+(?:instruct|request)|upon\s+charterers'?\s+(?:instruction|request)/i.test(clause),
    };
    span("jitClause", jitHead[0].trim());
  }

  const found = [laytimeHours, nor, demurrageRatePerDay].filter((v) => v != null).length;
  return charterPartyTermsSchema.parse({
    reference: refLine,
    chartererName,
    chartererEmail,
    agentEmail,
    vesselName: vessel,
    laytimeHours,
    laytimeBasis: basis?.[0] ?? null,
    norNoticeHours: nor ? Number(nor[1]) : null,
    waitingTimeCounts: waitNo ? false : waitYes ? true : null,
    demurrageRatePerDay,
    despatchRatePerDay,
    currency: dem ? currencyCode(dem[1]) : null,
    jitClause,
    confidence: found === 3 ? 0.9 : found === 0 ? 0.2 : 0.6,
    sourceSpans: spans,
  });
}

// ---------- offline (mock) notice ----------

const fmtUtc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const money = (n: number, cur: string | null) =>
  `${cur ?? "USD"} ${Math.round(n).toLocaleString("en-US")}`;

const EVENT_TEXT: Record<string, string> = {
  BERTH_DELAY: "a berth delay",
  CONGESTION: "port congestion",
  CLOSURE: "a port closure",
};

/** Deterministic notice template; also the fallback when a real LLM fails. */
export async function mockDraftNotice(f: NoticeFacts): Promise<NoticeDraft> {
  const why = EVENT_TEXT[f.portEventType] ?? "a port event";
  const delay = f.delayHours != null ? ` of ${Math.round(f.delayHours)} h` : "";
  const lines: string[] = [];
  lines.push(`Dear ${f.cp?.chartererName ?? "Charterers"},`, "");
  lines.push(`Re: ${f.vesselName} (IMO ${f.imo}) — ${f.originPortName} / ${f.destPortName}${f.cp?.reference ? ` — ${f.cp.reference}` : ""}`, "");
  lines.push(
    `${f.reportedBy ? `${f.reportedBy} has advised` : "We have been advised of"} ${why}${delay} at ${f.destPortName}. ` +
      `The berth is now expected at ${fmtUtc(f.berthTimeUtc)}.`,
    ""
  );
  lines.push(
    `To arrive at the berth time we have approved scenario ${f.scenarioLabel}: ${f.scenarioDescription} ` +
      `Speed ${f.previousSpeedKn.toFixed(1)} kn → ${f.newSpeedKn.toFixed(1)} kn.`,
    ""
  );
  lines.push(`Revised ETA ${f.destPortName}: ${fmtUtc(f.newEtaUtc)} (previously ${fmtUtc(f.previousEtaUtc)}).`, "");

  if (f.cp) {
    lines.push("Charter party terms considered:");
    if (f.cp.laytimeHours != null) {
      lines.push(
        `- Laytime: ${f.cp.laytimeHours} running hours${f.cp.laytimeBasis ? ` ${f.cp.laytimeBasis}` : ""}` +
          `${f.cp.norNoticeHours != null ? `, NOR turn time ${f.cp.norNoticeHours} h` : ""}` +
          `${f.cp.waitingTimeCounts ? ", time waiting for berth counts (WIBON)" : ""}.` +
          (f.cp.laytimeUsedHours != null
            ? ` Estimated laytime used on this arrival: ${f.cp.laytimeUsedHours.toFixed(0)} h of ${f.cp.laytimeHours} h` +
              `${f.cp.withinLaytime ? " (within laytime)." : " (exceeds laytime)."}`
            : "")
      );
    }
    if (f.cp.demurrageRatePerDay != null) {
      lines.push(
        `- Demurrage: ${money(f.cp.demurrageRatePerDay, f.cp.currency)} per day pro rata.` +
          (f.cp.demurrageAvoided != null && f.cp.demurrageAvoided > 0
            ? ` Arriving at the berth time instead of waiting at anchor avoids about ${money(f.cp.demurrageAvoided, f.cp.currency)} of demurrage.`
            : "")
      );
    }
    const clause = f.cp.jitClauseName ?? "the just-in-time arrival clause";
    const jitLine: Record<string, string> = {
      COVERED: `- Speed adjusted as permitted by ${clause}.`,
      NEEDS_INSTRUCTION: `- Speed adjusted under ${clause}. Please confirm this revised arrival as your instruction under the clause.`,
      NOT_COVERED:
        "- The charter party has no just-in-time arrival clause. We propose this speed adjustment and request your written agreement; failing it the vessel will continue with utmost despatch.",
      NOT_APPLICABLE: "- No speed reduction: the vessel continues with utmost despatch.",
    };
    lines.push(jitLine[f.cp.jitStatus] ?? `- ${f.cp.jitCoverage}`);
    lines.push("");
    lines.push("Please confirm by return that the revised arrival is in order under the charter party.", "");
  } else {
    lines.push("Please confirm by return that the revised arrival is in order.", "");
  }

  lines.push(
    `Expected effect: about ${f.fuelSavedT.toFixed(1)} t less fuel and ${f.co2SavedT.toFixed(1)} t less CO₂ than arriving early and waiting at anchor. Weather on the route: ${f.weather}.`,
    ""
  );
  lines.push("Agents, please update the berth planning with the revised ETA and confirm the berth time.", "");
  lines.push("Best regards,", "Operations");

  return {
    subject: `${f.vesselName} — revised ETA ${f.destPortName} ${fmtUtc(f.newEtaUtc)} (${why.replace(/^a /, "")})`,
    body: lines.join("\n"),
  };
}
