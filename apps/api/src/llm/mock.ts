import type { Answer, PortEventExtraction } from "@maritime/shared";
import { portEventExtractionSchema } from "@maritime/shared";
import type { CitableRow, RecommendationFacts } from "./types.js";

const KNOWN_PORTS: Array<{ name: string; unlocode: string }> = [
  { name: "Piraeus", unlocode: "GRPIR" },
  { name: "Rotterdam", unlocode: "NLRTM" },
  { name: "Hamburg", unlocode: "DEHAM" },
  { name: "Antwerp", unlocode: "BEANR" },
  { name: "Valencia", unlocode: "ESVLC" },
  { name: "Algeciras", unlocode: "ESALG" },
  { name: "Genoa", unlocode: "ITGOA" },
  { name: "Singapore", unlocode: "SGSIN" },
  { name: "Shanghai", unlocode: "CNSHA" },
  { name: "Jebel Ali", unlocode: "AEJEA" },
  { name: "Santos", unlocode: "BRSSZ" },
  { name: "Houston", unlocode: "USHOU" },
];

const CLOSURE_KEYWORDS = ["closure", "closed", "suspended operations", "κλειστό"];
const CONGESTION_KEYWORDS = ["congestion", "congested", "συμφόρηση"];
const DELAY_KEYWORDS = ["delay", "delayed", "καθυστέρηση", "καθυστερημένο"];

interface SourceSpan {
  field: string;
  text: string;
}

/**
 * Returns the earliest match among the given keywords, so that whichever
 * event type is mentioned first in the email (typically in the subject
 * line) wins, even when a later sentence mentions a different keyword
 * (e.g. a berth-delay email that also explains the congestion that caused
 * it).
 */
function firstMatch(text: string, keywords: string[]): { index: number; span: string } | null {
  const lower = text.toLowerCase();
  let best: { index: number; span: string } | null = null;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, span: text.slice(idx, idx + kw.length) };
    }
  }
  return best;
}

function detectPort(text: string): { name: string | null; unlocode: string | null; span: string | null } {
  const unlocodeMatch = text.match(/\b([A-Z]{5})\b/);
  if (unlocodeMatch) {
    const code = unlocodeMatch[1];
    const known = KNOWN_PORTS.find((p) => p.unlocode === code);
    if (known) {
      return { name: known.name, unlocode: known.unlocode, span: unlocodeMatch[0] };
    }
  }
  for (const port of KNOWN_PORTS) {
    const idx = text.toLowerCase().indexOf(port.name.toLowerCase());
    if (idx !== -1) {
      return {
        name: port.name,
        unlocode: port.unlocode,
        span: text.slice(idx, idx + port.name.length),
      };
    }
  }
  return { name: null, unlocode: null, span: null };
}

function detectVessel(text: string): { name: string | null; span: string | null } {
  // Uses horizontal whitespace only ([^\S\n]) between name parts so the match
  // never crosses a line break into an unrelated capitalized word that
  // happens to start the next line (e.g. a "Dear Captain," greeting
  // immediately following a vessel name at the end of a subject line).
  const match = text.match(/\bMV[^\S\n]+[A-Z][\p{L}]+(?:[^\S\n]+[A-Z][\p{L}]+)*/u);
  if (match) {
    return { name: match[0], span: match[0] };
  }
  return { name: null, span: null };
}

function detectDelayHours(text: string): { hours: number | null; span: string | null } {
  const match = text.match(
    /delay(?:ed)?\s*(?:by|of)?\s*(\d+(?:\.\d+)?)\s*hours?|καθυστέρηση[\s\p{L}]*?(\d+(?:\.\d+)?)\s*(?:ωρών|ώρες)/iu
  );
  if (match) {
    const value = match[1] ?? match[2];
    return { hours: value ? Number(value) : null, span: match[0] };
  }
  return { hours: null, span: null };
}

const DATE_PATTERN = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})(?:\s*UTC)?/;

function detectNewBerthTime(text: string): { iso: string | null; span: string | null } {
  const match = text.match(DATE_PATTERN);
  if (match) {
    const parsed = new Date(`${match[1].replace(" ", "T")}:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return { iso: parsed.toISOString(), span: match[0] };
    }
  }
  return { iso: null, span: null };
}

const FUEL_GRADE = /\b(VLSFO|LSMGO|ULSFO|HSFO|MGO)\b/i;
const OFFER_WORDS = /\b(offer|offering|quote|quotation|firm price)\b|προσφορά/i;
const PRICE_PATTERNS = [
  /(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)\s*(?:mt|t|tons?|tonnes?|metric\s+tons?)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:USD|US\$|\$|δολάρια)\s*(?:\/|per\s+|ανά\s+)\s*(?:mt|t|tons?|tonnes?|τόνο)/i,
];
const QTY_RANGE = /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:–|-|to|έως)\s*(\d{1,3}(?:,\d{3})*|\d+)\s*(?:mt|t|tonnes|metric\s+tons|τόνοι|τόνων)(?![\p{L}\d])/iu;
const QTY_SINGLE = /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:mt|tonnes|metric\s+tons|τόνοι|τόνων)(?![\p{L}\d])/iu;
const VALID_UNTIL =
  /(?:valid\s+(?:until|till|through|to)|expires?(?:\s+on)?|ισχύει\s+(?:έως|μέχρι))\s+(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?)(?:\s*UTC)?/i;
const SIGN_OFF = /(?:regards|best|sincerely|εκτίμηση|χαιρετισμούς),?\s*\n\s*([^\n]+)/i;

const toNumber = (v: string) => Number(v.replace(/,/g, ""));

/** The supply port: the known port named right after "at"/"in"/"ex", else the first one mentioned. */
function detectBunkerPort(text: string) {
  const names = KNOWN_PORTS.map((p) => p.name).join("|");
  const at = text.match(new RegExp(`(?:\\b(?:at|in|ex|off)|στο|στην)\\s+(?:the\\s+)?(?:port\\s+of\\s+)?(${names})\\b`, "i"));
  if (at) {
    const known = KNOWN_PORTS.find((p) => p.name.toLowerCase() === at[1].toLowerCase())!;
    return { name: known.name, unlocode: known.unlocode, span: at[1] };
  }
  let best: { name: string; unlocode: string; span: string; index: number } | null = null;
  const lower = text.toLowerCase();
  for (const port of KNOWN_PORTS) {
    const idx = lower.indexOf(port.name.toLowerCase());
    if (idx !== -1 && (!best || idx < best.index)) {
      best = { ...port, span: text.slice(idx, idx + port.name.length), index: idx };
    }
  }
  return best;
}

/** A specific fuel offer: grade + price + offer wording. Price lists and newsletters don't qualify. */
function extractBunkerOffer(text: string): PortEventExtraction | null {
  const grade = text.match(FUEL_GRADE);
  const price = PRICE_PATTERNS.map((re) => text.match(re)).find((m) => m !== null);
  const offerWord = text.match(OFFER_WORDS);
  if (!grade || !price || !offerWord) return null;
  const port = detectBunkerPort(text);
  if (!port) return null;

  const range = text.match(QTY_RANGE);
  const single = range ? null : text.match(QTY_SINGLE);
  const valid = text.match(VALID_UNTIL);
  const detected = detectVessel(text);
  // "MV Aegean Star VLSFO at ..." – a fuel grade right after the name isn't part of it.
  const vesselName = detected.name?.replace(/(?:\s+(?:VLSFO|LSMGO|ULSFO|HSFO|MGO))+$/, "") ?? null;
  const vessel = { name: vesselName, span: vesselName };
  const signOff = text.match(SIGN_OFF);

  const sourceSpans: SourceSpan[] = [
    { field: "eventType", text: offerWord[0] },
    { field: "portName", text: port.span },
    { field: "fuelGrade", text: grade[0] },
    { field: "priceUsdPerT", text: price[0] },
  ];
  if (range) sourceSpans.push({ field: "qtyMaxT", text: range[0] });
  if (single) sourceSpans.push({ field: "qtyMaxT", text: single[0] });
  if (valid) sourceSpans.push({ field: "validUntil", text: valid[0] });
  if (vessel.span) sourceSpans.push({ field: "vesselNameMentioned", text: vessel.span });

  const qtyMin = range ? toNumber(range[1]) : single ? toNumber(single[1]) : null;
  const qtyMax = range ? toNumber(range[2]) : single ? toNumber(single[1]) : null;
  const validIso = valid
    ? new Date(valid[1].includes(":") ? `${valid[1].replace(" ", "T")}:00Z` : `${valid[1]}T23:59:00Z`).toISOString()
    : null;

  return portEventExtractionSchema.parse({
    eventType: "BUNKER_OFFER",
    portName: port.name,
    portUnlocode: port.unlocode,
    vesselNameMentioned: vessel.name,
    delayHours: null,
    newBerthTime: null,
    fuelGrade: grade[1].toUpperCase(),
    priceUsdPerT: Number(price[1]),
    qtyMinT: qtyMin,
    qtyMaxT: qtyMax,
    validUntil: validIso,
    supplier: signOff ? signOff[1].trim() : null,
    confidence: qtyMax !== null && valid ? 0.9 : 0.7,
    sourceSpans,
  });
}

const NO_OFFER = {
  fuelGrade: null,
  priceUsdPerT: null,
  qtyMinT: null,
  qtyMaxT: null,
  validUntil: null,
  supplier: null,
};

/**
 * Deterministic regex/template extraction. Handles the seeded demo emails
 * and the eval set emails (apps/api/eval/emails). Never calls an external
 * API, so the app works with no key configured.
 */
export async function mockExtractEmail(text: string): Promise<PortEventExtraction> {
  // Checked first: an offer email may also say "delay" or name the ship's destination.
  const offer = extractBunkerOffer(text);
  if (offer) return offer;

  const port = detectPort(text);
  const vessel = detectVessel(text);
  const delay = detectDelayHours(text);
  const berthTime = detectNewBerthTime(text);

  const closureMatch = firstMatch(text, CLOSURE_KEYWORDS);
  const congestionMatch = firstMatch(text, CONGESTION_KEYWORDS);
  const delayMatch = firstMatch(text, DELAY_KEYWORDS);

  const candidates: Array<{
    type: PortEventExtraction["eventType"];
    match: { index: number; span: string } | null;
  }> = [
    { type: "CLOSURE", match: closureMatch },
    { type: "CONGESTION", match: congestionMatch },
    { type: "BERTH_DELAY", match: delayMatch },
  ];
  const earliest = candidates
    .filter((c): c is { type: PortEventExtraction["eventType"]; match: { index: number; span: string } } => c.match !== null)
    .sort((a, b) => a.match.index - b.match.index)[0];

  const eventType: PortEventExtraction["eventType"] = earliest ? earliest.type : "NONE";

  const hasActionableEvent = eventType !== "NONE" && port.name !== null;

  const sourceSpans: SourceSpan[] = [];
  if (hasActionableEvent) {
    const typeSpan = earliest?.match.span;
    if (typeSpan) sourceSpans.push({ field: "eventType", text: typeSpan });
    if (port.span) sourceSpans.push({ field: "portName", text: port.span });
    if (vessel.span) sourceSpans.push({ field: "vesselNameMentioned", text: vessel.span });
    if (delay.span) sourceSpans.push({ field: "delayHours", text: delay.span });
    if (berthTime.span) sourceSpans.push({ field: "newBerthTime", text: berthTime.span });
  }

  const extraction: PortEventExtraction = {
    eventType: hasActionableEvent ? eventType : "NONE",
    portName: hasActionableEvent ? port.name : null,
    portUnlocode: hasActionableEvent ? port.unlocode : null,
    vesselNameMentioned: hasActionableEvent ? vessel.name : null,
    delayHours: hasActionableEvent ? delay.hours : null,
    newBerthTime: hasActionableEvent ? berthTime.iso : null,
    ...NO_OFFER,
    confidence: hasActionableEvent ? (port.name && delay.hours !== null ? 0.9 : 0.6) : 0.95,
    sourceSpans,
  };

  return portEventExtractionSchema.parse(extraction);
}

const eur = (v: number) => `€${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

function explainBunker(facts: RecommendationFacts, b: NonNullable<RecommendationFacts["bunker"]>): string {
  const grade = b.fuelGrade ?? "fuel";
  const offer =
    `${b.bunkerPortName} offers ${b.qtyT.toLocaleString("en-US")} t of ${grade} at $${b.priceUsdPerT}/t, ` +
    `${b.priceSavingEur >= 0 ? "saving" : "costing"} ${eur(b.priceSavingEur)} against our reference price. `;
  const detour =
    `For ${facts.vesselName} (${facts.originPortName} → ${facts.destPortName}) the call is a ` +
    `${b.detourNm.toFixed(0)} nm detour and about ${b.extraHours.toFixed(0)} h extra, burning ` +
    `${b.extraFuelT.toFixed(1)} t more fuel. `;
  if (b.verdict === "WORTH_IT") {
    return (
      offer + detour +
      `It still makes the ${facts.destPortName} berth` +
      (facts.recommendedSpeedKn > facts.currentSpeedKn + 0.05
        ? ` by sailing at ${facts.recommendedSpeedKn.toFixed(1)} kn instead of ${facts.currentSpeedKn.toFixed(1)} kn`
        : "") +
      `, so the net result is ${eur(b.netEur)} saved.`
    );
  }
  const why = [
    b.netEur <= 0 ? `the detour costs ${eur(b.netEur)} more than the cheaper fuel saves` : null,
    !b.stillMakesBerth ? `the ship would miss the ${facts.destPortName} berth even at full speed` : null,
    !b.offerValidAtArrival ? "the offer expires before the ship could get there" : null,
  ].filter((x): x is string => x !== null);
  const list = why.length <= 1 ? (why[0] ?? "") : `${why.slice(0, -1).join(", ")} and ${why[why.length - 1]}`;
  return offer + detour + `Not worth it: ${list}.`;
}

export async function mockExplainRecommendation(facts: RecommendationFacts): Promise<string> {
  if (facts.bunker) return explainBunker(facts, facts.bunker);
  return (
    `${facts.portName} has reported ${facts.portEventType.toLowerCase().replace("_", " ")} ` +
    `affecting ${facts.vesselName} on its ${facts.originPortName} → ${facts.destPortName} voyage, ` +
    `pushing the berth time back by ${facts.delayHours.toFixed(0)} hours. ` +
    `Slowing from ${facts.currentSpeedKn.toFixed(1)} kn to ${facts.recommendedSpeedKn.toFixed(1)} kn ` +
    `lets the vessel arrive exactly when the berth is ready instead of rushing to wait at anchor, ` +
    `saving an estimated ${facts.fuelSavedT.toFixed(1)} t of fuel ` +
    `(€${Math.round(facts.costSavedEur).toLocaleString("en-US")}) and ` +
    `${facts.co2SavedT.toFixed(1)} t of CO₂ emissions.`
  );
}

function rowMatchesVesselName(row: CitableRow, name: string): boolean {
  const vesselName = row.data.vesselName ?? row.data.name;
  return typeof vesselName === "string" && vesselName.toLowerCase() === name.toLowerCase();
}

export async function mockAnswerQuestion(question: string, rows: CitableRow[]): Promise<Answer> {
  const q = question.toLowerCase();

  const vesselMatch = question.match(/\bMV\s+[A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)*/u);

  if (q.includes("fuel") && (q.includes("saved") || q.includes("approved"))) {
    const approved = rows.filter(
      (r) => r.table === "recommendation" && r.data.status === "APPROVED"
    );
    const total = approved.reduce((sum, r) => sum + Number(r.data.fuelSavedT ?? 0), 0);
    if (approved.length === 0) {
      return {
        answer: "No actions have been approved yet, so 0 t of fuel has been saved so far.",
        citations: [],
      };
    }
    return {
      answer: `Approved actions have saved a total of ${total.toFixed(1)} t of fuel across ${
        approved.length
      } approved recommendation(s).`,
      citations: approved.map((r) => ({ table: r.table, id: r.id })),
    };
  }

  if ((q.includes("offer") || q.includes("bunker")) && (q.includes("why") || q.includes("take"))) {
    const offers = rows.filter((r) => r.table === "recommendation" && r.data.actionType === "BUNKER_DETOUR");
    const named = offers.filter((r) => typeof r.data.portName === "string" && q.includes(r.data.portName.toLowerCase()));
    const picked = named.length > 0 ? named : offers;
    if (picked.length > 0) {
      const lines = picked.map((r) => {
        const where = `${r.data.portName} offer for ${r.data.vesselName}`;
        if (r.data.status === "REJECTED") return `The ${where} was declined. ${r.data.rejectReason ?? ""}`.trim();
        if (r.data.status === "APPROVED") return `The ${where} was approved (net €${Math.round(Number(r.data.costSavedEur)).toLocaleString("en-US")}).`;
        return `The ${where} is waiting for a decision (net €${Math.round(Number(r.data.costSavedEur)).toLocaleString("en-US")}).`;
      });
      return { answer: lines.join(" "), citations: picked.map((r) => ({ table: r.table, id: r.id })) };
    }
  }

  if (vesselMatch && q.includes("eta")) {
    const voyageRow = rows.find(
      (r) => r.table === "voyage" && rowMatchesVesselName(r, vesselMatch[0])
    );
    if (voyageRow) {
      return {
        answer: `${vesselMatch[0]}'s planned ETA is ${voyageRow.data.plannedEta}.`,
        citations: [{ table: voyageRow.table, id: voyageRow.id }],
      };
    }
  }

  if (q.includes("affected") && (q.includes("delay") || q.includes("port"))) {
    const affectedVoyageIds = new Set(
      rows
        .filter((r) => r.table === "portEvent" && r.data.eventType !== "NONE")
        .map((r) => r.data.voyageId)
        .filter((id): id is string => typeof id === "string")
    );
    const affectedVoyages = rows.filter(
      (r) => r.table === "voyage" && affectedVoyageIds.has(r.id)
    );
    if (affectedVoyages.length > 0) {
      const names = affectedVoyages.map((r) => r.data.vesselName).join(", ");
      return {
        answer: `Vessels affected by reported port delays: ${names}.`,
        citations: affectedVoyages.map((r) => ({ table: r.table, id: r.id })),
      };
    }
  }

  return {
    answer:
      "Offline mode (no LLM API key configured): I can only answer a few fixed question types, " +
      "e.g. fuel saved from approved recommendations, why a bunker offer was or wasn't taken, a named vessel's ETA (\"What's MV Aegean " +
      "Star's ETA?\"), or which vessels are affected by port delays. Configure LLM_PROVIDER and " +
      "an API key to ask anything about the fleet.",
    citations: [],
  };
}
