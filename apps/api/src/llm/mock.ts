import type { Answer, OfferLine, PortEventExtraction } from "@maritime/shared";
import { portEventExtractionSchema } from "@maritime/shared";
import type { BunkerComparisonFacts, CitableRow, RecommendationFacts } from "./types.js";

export { mockDraftNotice, mockExtractCharterParty } from "./charterParty.js";

const KNOWN_PORTS: Array<{ name: string; unlocode: string; aliases?: string[] }> = [
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
  { name: "Gibraltar", unlocode: "GIGIB", aliases: ["Gib"] },
  { name: "Ceuta", unlocode: "ESCEU" },
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
    return { name: titleCaseShipName(match[0]), span: match[0] };
  }
  return { name: null, span: null };
}

/** "MV AEGEAN STAR" (subject-line capitals) -> "MV Aegean Star"; mixed case is left alone. */
function titleCaseShipName(name: string): string {
  const rest = name.replace(/^MV\s+/, "");
  if (rest !== rest.toUpperCase()) return name;
  return `MV ${rest.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase())}`;
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
const OFFER_WORDS = /\b(offers?|offering|quote|quotation|firm price|firm|can do)\b|προσφορά/i;
const PRICE_PATTERNS = [
  /(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)\s*(?:mt|t|tons?|tonnes?|metric\s+tons?)\b/i,
  /(\d+(?:\.\d+)?)\s*(?:USD|US\$|\$|δολάρια)\s*(?:\/|per\s+|ανά\s+)\s*(?:mt|t|tons?|tonnes?|τόνο)/i,
  // "usd 529 pmt": pmt = per metric tonne
  /(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)\s*(?:pmt|p\/mt)\b/i,
];
const QTY_RANGE = /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:–|-|to|έως|\/)\s*(\d{1,3}(?:,\d{3})*|\d+)\s*(?:mt|t|tonnes|metric\s+tons|τόνοι|τόνων)(?![\p{L}\d])/iu;
const QTY_SINGLE = /(\d{1,3}(?:,\d{3})*|\d+)\s*(?:mt|tonnes|metric\s+tons|τόνοι|τόνων)(?![\p{L}\d])/iu;
const VALID_UNTIL =
  /(?:valid\s+(?:until|till|through|to)|expires?(?:\s+on)?|ισχύει\s+(?:έως|μέχρι))\s+(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?)(?:\s*UTC)?/i;
const SIGN_OFF = /(?:regards|b?rgds|best|sincerely|εκτίμηση|χαιρετισμούς),?\s*\n\s*([^\n]+)/i;
/** "rgds Med Bunker Brokers" on one line. */
const SIGN_OFF_INLINE = /\b(?:b?rgds|regards)[^\S\n]+([A-Z][^\n]+)$/im;

// Commercial terms. Each is null when the email doesn't say.
const IMO = /\bIMO[\s:#]*(\d{7})\b/i;
const BARGING_PER_MT = /\bbarging\s*:?\s*(?:USD|US\$|\$)\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s*|p)\s*mt\b/i;
const BARGING_LUMP = /\bbarging\s*:?\s*(?:USD|US\$|\$)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/i;
const BARGING_INCL = /\bbarging\s*:?\s*incl|\bincl(?:uding|\.)?\s+barging|\ball[- ]in\b|\bdelivered\b|\bex[- ](?:pipe|pipeline|wharf)\b/i;
const OTHER_FEES = /\b(?:overtime|o\/t|agency\s+fee|port\s+dues|mooring)\b[^\n$]*?(?:USD|US\$|\$)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/gi;
const PAYMENT_DAYS = /\b(?:pmt|payment|paymt)\s*:?\s*(\d{1,3})\s*(?:days|dd|d)\b[^\n.(]*/i;
const PAYMENT_CIA = /\b(?:cash in advance|CIA|prepayment|pre-payment)\b/i;
const DELIVERY_ETA_PLUS = /ETA\s*\+\s*(\d+(?:\.\d+)?)\s*(?:hrs?|hours?|h)\b/i;
const DELIVERY_WITHIN = /within\s+(\d+(?:\.\d+)?)\s*(?:hrs?|hours?|h)\s+of\s+(?:the\s+)?(?:vsl'?s?\s+|vessel'?s?\s+)?arrival|εντός\s+(\d+)\s+ωρών/i;
const DELIVERY_PROMPT = /\bprompt\b|\bon\s+(?:the\s+)?(?:vsl'?s?\s+|vessel'?s?\s+)?arrival\b/i;
const QUOTE_VALIDITY = /\b(?:firm|valid(?:ity)?)\s*(?:for\s*)?(\d+(?:\.\d+)?)\s*(mins?|minutes|m|hrs?|hours?|h)\b/i;

const toNumber = (v: string) => Number(v.replace(/,/g, ""));

const portByName = (word: string) =>
  KNOWN_PORTS.find((p) => [p.name, ...(p.aliases ?? [])].some((n) => n.toLowerCase() === word.toLowerCase()))!;

/** The supply port: the known port named right after "at"/"in"/"ex", else the first one mentioned ("Gib" counts as Gibraltar). */
function detectBunkerPort(text: string) {
  const names = KNOWN_PORTS.flatMap((p) => [p.name, ...(p.aliases ?? [])]).join("|");
  const at = text.match(new RegExp(`(?:\\b(?:at|in|ex|off)|στο|στην)\\s+(?:the\\s+)?(?:port\\s+of\\s+)?(${names})\\b`, "i"));
  if (at) {
    const known = portByName(at[1]);
    return { name: known.name, unlocode: known.unlocode, span: at[1] };
  }
  const first = new RegExp(`\\b(${names})\\b`, "i").exec(text);
  if (!first) return null;
  const known = portByName(first[1]);
  return { name: known.name, unlocode: known.unlocode, span: first[1] };
}

const GRADE_ANYWHERE = new RegExp(FUEL_GRADE.source, "gi");

/**
 * One line per fuel grade: each grade's price and quantity are read from the
 * text between it and the next grade on the same line, so "vlsfo ... usd 529
 * pmt / lsmgo ... usd 735 pmt" stays two separate lines.
 */
function extractOfferLines(text: string): OfferLine[] {
  const hits = [...text.matchAll(GRADE_ANYWHERE)];
  const lines: OfferLine[] = [];
  hits.forEach((hit, i) => {
    const start = hit.index!;
    const lineEnd = text.indexOf("\n", start);
    const nextGrade = i + 1 < hits.length ? hits[i + 1].index! : text.length;
    const segment = text.slice(start, Math.min(nextGrade, lineEnd === -1 ? text.length : lineEnd));
    const price = PRICE_PATTERNS.map((re) => segment.match(re)).find((m) => m !== null);
    const grade = hit[1].toUpperCase();
    if (!price || lines.some((l) => l.fuelGrade === grade)) return;
    const range = segment.match(QTY_RANGE);
    const single = range ? null : segment.match(QTY_SINGLE);
    lines.push({
      fuelGrade: grade,
      priceUsdPerT: Number(price[1]),
      qtyMinT: range ? toNumber(range[1]) : single ? toNumber(single[1]) : null,
      qtyMaxT: range ? toNumber(range[2]) : single ? toNumber(single[1]) : null,
    });
  });
  return lines;
}

/** Barging, fees, credit, delivery window and how long the price is firm. */
function extractOfferTerms(text: string) {
  const imo = text.match(IMO);
  const perMt = text.match(BARGING_PER_MT);
  const lump = perMt ? null : text.match(BARGING_LUMP);
  const incl = text.match(BARGING_INCL);
  const bargingType: "PER_MT" | "LUMP_SUM" | "INCLUDED" | null = perMt ? "PER_MT" : lump ? "LUMP_SUM" : incl ? "INCLUDED" : null;
  const fees = [...text.matchAll(OTHER_FEES)].reduce((sum, m) => sum + toNumber(m[1]), 0);
  const days = text.match(PAYMENT_DAYS);
  const cia = days ? null : text.match(PAYMENT_CIA);
  const etaPlus = text.match(DELIVERY_ETA_PLUS);
  const within = etaPlus ? null : text.match(DELIVERY_WITHIN);
  const prompt = etaPlus || within ? null : text.match(DELIVERY_PROMPT);
  const delivery = etaPlus ? Number(etaPlus[1]) : within ? Number(within[1] ?? within[2]) : prompt ? 0 : null;
  const validity = text.match(QUOTE_VALIDITY);
  const validityMinutes = validity ? Number(validity[1]) * (/^h/i.test(validity[2]) ? 60 : 1) : null;
  return {
    vesselImo: imo ? imo[1] : null,
    bargingType,
    bargingUsd: perMt ? Number(perMt[1]) : lump ? toNumber(lump[1]) : null,
    otherFeesUsd: fees > 0 ? fees : null,
    paymentTerms: days ? days[0].trim() : cia ? cia[0] : null,
    paymentDays: days ? Number(days[1]) : cia ? 0 : null,
    deliveryDelayHours: delivery,
    quoteValidityMinutes: validityMinutes,
    spans: {
      vesselImo: imo?.[0],
      bargingType: (perMt ?? lump ?? incl)?.[0],
      paymentDays: (days ?? cia)?.[0],
      deliveryDelayHours: (etaPlus ?? within ?? prompt)?.[0],
      quoteValidityMinutes: validity?.[0],
    },
  };
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
  const vesselName = detected.name?.replace(/(?:\s+(?:VLSFO|LSMGO|ULSFO|HSFO|MGO))+$/i, "") ?? null;
  const vessel = { name: vesselName, span: detected.span?.replace(/(?:\s+(?:VLSFO|LSMGO|ULSFO|HSFO|MGO))+$/i, "") ?? null };
  const signOff = text.match(SIGN_OFF) ?? text.match(SIGN_OFF_INLINE);
  const terms = extractOfferTerms(text);
  const lines = extractOfferLines(text);

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
  for (const [field, span] of Object.entries(terms.spans)) {
    if (span) sourceSpans.push({ field, text: span });
  }

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
    vesselImo: terms.vesselImo,
    vesselEta: null,
    bargingType: terms.bargingType,
    bargingUsd: terms.bargingUsd,
    otherFeesUsd: terms.otherFeesUsd,
    paymentTerms: terms.paymentTerms,
    paymentDays: terms.paymentDays,
    deliveryDelayHours: terms.deliveryDelayHours,
    deliveryEarliest: null,
    quoteValidityMinutes: terms.quoteValidityMinutes,
    offerLines:
      lines.length > 0
        ? lines
        : [{ fuelGrade: grade[1].toUpperCase(), priceUsdPerT: Number(price[1]), qtyMinT: qtyMin, qtyMaxT: qtyMax }],
    confidence: qtyMax !== null && (valid || terms.quoteValidityMinutes !== null) ? 0.9 : 0.7,
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
  vesselImo: null,
  vesselEta: null,
  bargingType: null,
  bargingUsd: null,
  otherFeesUsd: null,
  paymentTerms: null,
  paymentDays: null,
  deliveryDelayHours: null,
  deliveryEarliest: null,
  quoteValidityMinutes: null,
  offerLines: null,
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

/** ["α", "β", "γ"] -> "α, β και γ" */
function joinKai(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} και ${parts[parts.length - 1]}`;
}

function explainBunker(facts: RecommendationFacts, b: NonNullable<RecommendationFacts["bunker"]>): string {
  const grade = b.fuelGrade ?? "καυσίμου";
  const offer =
    `Το ${b.bunkerPortName} προσφέρει ${b.qtyT.toLocaleString("en-US")} t ${grade} στα $${b.priceUsdPerT}/t, ` +
    `${b.priceSavingEur >= 0 ? "γλιτώνοντας" : "με επιπλέον κόστος"} ${eur(b.priceSavingEur)} σε σχέση με την τιμή αναφοράς μας. `;
  const detour =
    `Για το ${facts.vesselName} (${facts.originPortName} → ${facts.destPortName}) η προσέγγιση σημαίνει ` +
    `παράκαμψη ${b.detourNm.toFixed(0)} nm και περίπου ${b.extraHours.toFixed(0)} h επιπλέον, με ` +
    `${b.extraFuelT.toFixed(1)} t επιπλέον καύσιμο. `;
  if (b.verdict === "WORTH_IT") {
    return (
      offer + detour +
      `Το πλοίο προλαβαίνει ακόμα την πρόσδεση στο ${facts.destPortName}` +
      (facts.recommendedSpeedKn > facts.currentSpeedKn + 0.05
        ? ` πλέοντας με ${facts.recommendedSpeedKn.toFixed(1)} kn αντί για ${facts.currentSpeedKn.toFixed(1)} kn`
        : "") +
      `, οπότε το καθαρό όφελος είναι ${eur(b.netEur)}.`
    );
  }
  const why = [
    b.netEur <= 0 ? `η παράκαμψη κοστίζει ${eur(b.netEur)} περισσότερα απ' όσα γλιτώνει το φθηνότερο καύσιμο` : null,
    !b.stillMakesBerth ? `το πλοίο θα έχανε την πρόσδεση στο ${facts.destPortName} ακόμα και με πλήρη ταχύτητα` : null,
    !b.offerValidAtArrival ? "η προσφορά λήγει πριν προλάβει να φτάσει το πλοίο" : null,
  ].filter((x): x is string => x !== null);
  return offer + detour + `Δεν αξίζει: ${joinKai(why)}.`;
}

/** Offline: the deterministic explanation, as one paragraph. */
export async function mockExplainBunkerComparison(facts: BunkerComparisonFacts): Promise<string> {
  const { headline, reasons, warnings } = facts.draft;
  const why = reasons.length > 0 ? ` Γιατί: ${reasons.join("· ")}.` : "";
  return `${headline}${why}${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`;
}

const EVENT_WORDS: Record<string, string> = {
  BERTH_DELAY: "καθυστέρηση πρόσδεσης",
  CONGESTION: "συμφόρηση",
  CLOSURE: "κλείσιμο λιμανιού",
};

export async function mockExplainRecommendation(facts: RecommendationFacts): Promise<string> {
  if (facts.bunker) return explainBunker(facts, facts.bunker);
  const how =
    facts.scenarioLabel && facts.scenarioLabel.startsWith("C")
      ? `Η αλλαγή διαδρομής (${facts.scenarioDescription ?? "γύρω από τον καιρό"}) με ${facts.recommendedSpeedKn.toFixed(1)} kn `
      : `Η μείωση ταχύτητας από ${facts.currentSpeedKn.toFixed(1)} kn σε ${facts.recommendedSpeedKn.toFixed(1)} kn `;
  return (
    `Το ${facts.portName} ανέφερε ${EVENT_WORDS[facts.portEventType] ?? "συμβάν"} ` +
    `που αφορά το ${facts.vesselName} στο ταξίδι ${facts.originPortName} → ${facts.destPortName}, ` +
    `μεταθέτοντας την πρόσδεση κατά ${facts.delayHours.toFixed(0)} ώρες. ` +
    how +
    `επιτρέπει στο πλοίο να φτάσει ακριβώς όταν η θέση είναι έτοιμη, αντί να βιαστεί για να περιμένει στην άγκυρα, ` +
    `γλιτώνοντας περίπου ${facts.fuelSavedT.toFixed(1)} t καυσίμου ` +
    `(€${Math.round(facts.costSavedEur).toLocaleString("en-US")}) και ` +
    `${facts.co2SavedT.toFixed(1)} t CO₂` +
    (facts.etsSavedEur && facts.etsSavedEur > 0
      ? ` (€${Math.round(facts.etsSavedEur).toLocaleString("en-US")} σε δικαιώματα EU ETS)`
      : "") +
    "." +
    (facts.demurrageAvoided && facts.demurrageAvoided > 0
      ? ` Επίσης κρατά την εκφόρτωση εντός laytime, αποφεύγοντας περίπου ${facts.currency ?? "USD"} ` +
        `${Math.round(facts.demurrageAvoided).toLocaleString("en-US")} demurrage.`
      : "") +
    (facts.jitNote ? ` Ναυλοσύμφωνο: ${facts.jitNote}` : "")
  );
}

function rowMatchesVesselName(row: CitableRow, name: string): boolean {
  const vesselName = row.data.vesselName ?? row.data.name;
  return typeof vesselName === "string" && vesselName.toLowerCase() === name.toLowerCase();
}

/** Greek spellings people type for the demo ports, so «Γένοβα» finds Genoa. */
const GREEK_PORT_NAMES: Record<string, string[]> = {
  genoa: ["γένοβα"],
  algeciras: ["αλχεθίρας", "αλγεθίρας", "αλγκεθίρας"],
  gibraltar: ["γιβραλτάρ"],
  ceuta: ["θέουτα", "σέουτα"],
  rotterdam: ["ρότερνταμ"],
  singapore: ["σιγκαπούρη"],
  valencia: ["βαλένθια", "βαλένσια"],
  "jebel ali": ["τζεμπέλ αλί"],
};

const has = (q: string, words: string[]) => words.some((w) => q.includes(w));

export async function mockAnswerQuestion(question: string, rows: CitableRow[]): Promise<Answer> {
  const q = question.toLowerCase();

  const vesselMatch = question.match(/\bMV\s+[A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)*/u);

  if (has(q, ["fuel", "καύσιμ"]) && has(q, ["saved", "approved", "γλιτ", "εγκεκριμ", "εξοικον"])) {
    const approved = rows.filter(
      (r) => r.table === "recommendation" && r.data.status === "APPROVED"
    );
    const total = approved.reduce((sum, r) => sum + Number(r.data.fuelSavedT ?? 0), 0);
    if (approved.length === 0) {
      return {
        answer: "Δεν έχει εγκριθεί ακόμα καμία ενέργεια, οπότε ως τώρα έχουν γλιτωθεί 0 t καυσίμου.",
        citations: [],
      };
    }
    return {
      answer: `Οι εγκεκριμένες ενέργειες έχουν γλιτώσει συνολικά ${total.toFixed(1)} t καυσίμου από ${
        approved.length
      } εγκεκριμένες συστάσεις.`,
      citations: approved.map((r) => ({ table: r.table, id: r.id })),
    };
  }

  if (has(q, ["offer", "bunker", "προσφορ", "ανεφοδιασ"]) && has(q, ["why", "take", "γιατί", "γιατι", "πήραμε", "πάρουμε"])) {
    const offers = rows.filter((r) => r.table === "recommendation" && r.data.actionType === "BUNKER_DETOUR");
    const named = offers.filter((r) => {
      if (typeof r.data.portName !== "string") return false;
      const name = r.data.portName.toLowerCase();
      return q.includes(name) || has(q, GREEK_PORT_NAMES[name] ?? []);
    });
    const picked = named.length > 0 ? named : offers;
    if (picked.length > 0) {
      const lines = picked.map((r) => {
        const where = `προσφορά του ${r.data.portName} για το ${r.data.vesselName}`;
        const net = `καθαρό €${Math.round(Number(r.data.costSavedEur)).toLocaleString("en-US")}`;
        const flagged = r.data.verdict === "NOT_WORTH_IT" ? ` Είχε σημειωθεί ότι δεν αξίζει: ${r.data.notWorthItBecause}.` : "";
        if (r.data.status === "REJECTED") {
          return `Η ${where} απορρίφθηκε${r.data.rejectReason ? ` (αιτιολογία: ${r.data.rejectReason})` : ""}.${flagged}`;
        }
        if (r.data.status === "APPROVED") return `Η ${where} εγκρίθηκε (${net}).${flagged}`;
        return `Η ${where} περιμένει απόφαση (${net}).${flagged}`;
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
        answer: `Το προγραμματισμένο ETA του ${vesselMatch[0]} είναι ${voyageRow.data.plannedEta}.`,
        citations: [{ table: voyageRow.table, id: voyageRow.id }],
      };
    }
  }

  if (q.includes("cii")) {
    const atSea = rows.filter((r) => r.table === "voyage" && r.data.status === "UNDERWAY" && typeof r.data.ciiRating === "string");
    const poor = atSea.filter((r) => r.data.ciiRating === "D" || r.data.ciiRating === "E");
    const fmt = (r: CitableRow) => `${r.data.vesselName} (${r.data.ciiRating}${typeof r.data.ciiAttained === "number" ? `, ${r.data.ciiAttained.toFixed(2)}` : ""})`;
    if (poor.length > 0) {
      return {
        answer:
          `Πλοία σε ταξίδι με βαθμό CII D ή E: ${poor.map(fmt).join(", ")}. ` +
          "Η αργή πλεύση (σενάριο B) μειώνει την ένταση άνθρακα όταν υπάρχει περιθώριο ως την πρόσδεση.",
        citations: poor.map((r) => ({ table: r.table, id: r.id })),
      };
    }
    if (atSea.length > 0) {
      const worst = [...atSea].sort((a, b) => String(b.data.ciiRating).localeCompare(String(a.data.ciiRating)))[0];
      return {
        answer: `Κανένα πλοίο σε ταξίδι δεν έχει βαθμό CII D ή E. Ο χαμηλότερος είναι του ${fmt(worst)}.`,
        citations: [{ table: worst.table, id: worst.id }],
      };
    }
  }

  if (has(q, ["affected", "επηρε"]) && has(q, ["delay", "port", "καθυστ", "λιμ"])) {
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
        answer: `Πλοία που επηρεάζονται από αναφερθείσες καθυστερήσεις λιμανιών: ${names}.`,
        citations: affectedVoyages.map((r) => ({ table: r.table, id: r.id })),
      };
    }
  }

  return {
    answer:
      "Offline λειτουργία (δεν έχει οριστεί κλειδί LLM): απαντώ μόνο σε λίγους τύπους ερωτήσεων, " +
      "π.χ. πόσο καύσιμο γλιτώσαμε από εγκεκριμένες συστάσεις, γιατί πήραμε ή όχι μια προσφορά καυσίμου, το ETA ενός πλοίου " +
      "(«Ποιο είναι το ETA του MV Aegean Star;») ή ποια πλοία επηρεάζονται από καθυστερήσεις λιμανιών. Ορίστε LLM_PROVIDER " +
      "και κλειδί API για οποιαδήποτε ερώτηση για τον στόλο.",
    citations: [],
  };
}
