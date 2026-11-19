import { portEventExtractionSchema, type PortEventExtraction } from "@maritime/shared";

/** System prompt shared by the real-LLM providers (OpenAI, Anthropic). */
export const EXTRACTION_SYSTEM_PROMPT =
  "You extract structured port-event data from maritime port-agent emails. " +
  "Reply with ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape: " +
  '{"eventType":"BERTH_DELAY"|"CONGESTION"|"CLOSURE"|"BUNKER_OFFER"|"NONE","portName":string|null,' +
  '"portUnlocode":string|null,"vesselNameMentioned":string|null,"delayHours":number|null,' +
  '"newBerthTime":string|null,"fuelGrade":string|null,"priceUsdPerT":number|null,' +
  '"qtyMinT":number|null,"qtyMaxT":number|null,"validUntil":string|null,"supplier":string|null,' +
  '"vesselImo":string|null,"vesselEta":string|null,"bargingType":"INCLUDED"|"LUMP_SUM"|"PER_MT"|null,' +
  '"bargingUsd":number|null,"otherFeesUsd":number|null,"paymentTerms":string|null,"paymentDays":number|null,' +
  '"deliveryDelayHours":number|null,"deliveryEarliest":string|null,"quoteValidityMinutes":number|null,' +
  '"offerLines":[{"fuelGrade":string,"priceUsdPerT":number,"qtyMinT":number|null,"qtyMaxT":number|null}]|null,' +
  '"confidence":number (0-1),"sourceSpans":[{"field":string,"text":string}]}. ' +
  "BUNKER_OFFER is a fuel supplier offering a specific fuel delivery at a named port: portName is the " +
  "port where the fuel is supplied (not the ship's destination), fuelGrade e.g. VLSFO/MGO, " +
  "priceUsdPerT the price in US dollars per metric ton, qtyMinT/qtyMaxT the offered quantity in " +
  "metric tons (both equal for a single figure), validUntil when the offer expires (same format as " +
  "newBerthTime), supplier the company offering. A price list, market report or newsletter with no " +
  'specific offer is "NONE". For other event types leave the bunker fields null. ' +
  "Bunker offers are written in trader shorthand: pmt after a price = per metric ton, but pmt/payment " +
  "before a number of days = payment terms; b/d = bunker delivery; l/s = lump sum; subj = subject to; " +
  '"firm 15m"/"valid 30 mins" = the price is firm for that long (quoteValidityMinutes; hours x 60). ' +
  "vesselImo: the 7-digit IMO number if given. bargingType: INCLUDED for delivered/all-in/barging incl./" +
  "ex-pipe, LUMP_SUM with bargingUsd the USD total, PER_MT with bargingUsd in USD per ton; null if not stated. " +
  "otherFeesUsd: overtime, agency or similar charges in USD, summed. paymentDays: days of credit " +
  "(cash in advance = 0), paymentTerms the wording. deliveryDelayHours: hours after the vessel's arrival " +
  'the barge comes alongside ("ETA+12 hrs" = 12, "prompt"/"on arrival" = 0); deliveryEarliest if given ' +
  "as a date instead. offerLines: one entry per fuel grade quoted (an email may quote VLSFO and LSMGO " +
  "together); the top-level fuelGrade/priceUsdPerT/qtyMinT/qtyMaxT are the first line. " +
  'portName is the plain port name only, e.g. "Rotterdam", never "Port of Rotterdam". ' +
  'vesselNameMentioned is the ship\'s name as written, keeping its prefix, e.g. "MV Marathon Spirit" (not "Marathon Spirit"). ' +
  'newBerthTime is UTC in ISO 8601 ending in "Z", e.g. "2026-11-25T14:00:00.000Z"; ' +
  "treat times without a zone as UTC. " +
  "If the email mentions more than one event type, choose the one announced first " +
  "(usually in the subject line); later mentions are background, not the event. " +
  "Each sourceSpans[].text must be an exact substring copied from the email. " +
  'If the email describes no port event affecting a vessel, use eventType "NONE" and null fields.';

const PORT_PREFIXES = [/^the\s+/i, /^port\s+of\s+/i, /^λιμάνι\s+(του\s+|της\s+)?/i];
const PORT_SUFFIXES = [/\s+port$/i, /\s+harbou?r$/i];

/** "Port of Rotterdam" / "Rotterdam Port" -> "Rotterdam". Leaves "Port of Spain" alone. */
export function normalizePortName(name: string | null): string | null {
  if (name === null) return null;
  const original = name.trim();
  let n = original;
  for (const re of PORT_PREFIXES) n = n.replace(re, "");
  for (const re of PORT_SUFFIXES) n = n.replace(re, "");
  n = n.trim();
  if (!n || /^spain$/i.test(n)) return original || null;
  return n;
}

/** Any ISO-ish timestamp -> canonical "YYYY-MM-DDTHH:mm:ss.sssZ"; no zone means UTC. */
export function normalizeBerthTime(value: string | null): string | null {
  if (value === null) return null;
  let v = value.trim().replace(" ", "T");
  if (!v) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v);
  if (!hasZone && /T\d{2}:\d{2}/.test(v)) v += "Z";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Validate a model's raw JSON and smooth over harmless formatting differences. */
export function parseExtraction(raw: unknown): PortEventExtraction {
  const parsed = portEventExtractionSchema.parse(raw);
  if (parsed.eventType === "NONE") {
    // No event means nothing to act on; models sometimes still echo a ship or port.
    return {
      eventType: "NONE",
      portName: null,
      portUnlocode: null,
      vesselNameMentioned: null,
      delayHours: null,
      newBerthTime: null,
      fuelGrade: null,
      priceUsdPerT: null,
      qtyMinT: null,
      qtyMaxT: null,
      validUntil: null,
      supplier: null,
      ...NO_TERMS,
      confidence: parsed.confidence,
      sourceSpans: [],
    };
  }
  const bunker = parsed.eventType === "BUNKER_OFFER";
  return {
    ...parsed,
    portName: normalizePortName(parsed.portName),
    portUnlocode: parsed.portUnlocode ? parsed.portUnlocode.replace(/\s+/g, "").toUpperCase() : null,
    newBerthTime: normalizeBerthTime(parsed.newBerthTime),
    // Offer fields only mean something on an offer; models sometimes echo prices elsewhere.
    fuelGrade: bunker ? normalizeFuelGrade(parsed.fuelGrade) : null,
    priceUsdPerT: bunker ? (parsed.priceUsdPerT ?? null) : null,
    qtyMinT: bunker ? (parsed.qtyMinT ?? parsed.qtyMaxT ?? null) : null,
    qtyMaxT: bunker ? (parsed.qtyMaxT ?? parsed.qtyMinT ?? null) : null,
    validUntil: bunker ? normalizeBerthTime(parsed.validUntil ?? null) : null,
    supplier: bunker ? (parsed.supplier?.trim() || null) : null,
    ...(bunker ? normalizeTerms(parsed) : NO_TERMS),
  };
}

const GRADES = /\b(VLSFO|ULSFO|LSMGO|HSFO|LSFO|MGO|MDO|LNG|HFO)\b/i;

/** "VLSFO 0.5%" / "vlsfo (RMG380)" -> "VLSFO": offers are compared by grade, so the spec text is dropped. */
export function normalizeFuelGrade(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return v.match(GRADES)?.[1].toUpperCase() ?? v.toUpperCase();
}

const NO_TERMS = {
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
} as const;

/** Offer terms as models return them -> one shape (numbers non-negative, IMO digits only, grades upper-case). */
function normalizeTerms(p: PortEventExtraction) {
  const nonNeg = (v: number | null | undefined) => (v === null || v === undefined || v < 0 ? null : v);
  const imo = p.vesselImo?.replace(/\D/g, "") ?? "";
  const lines = (p.offerLines ?? []).map((l) => ({ ...l, fuelGrade: normalizeFuelGrade(l.fuelGrade) ?? l.fuelGrade.trim().toUpperCase() }));
  return {
    vesselImo: imo.length === 7 ? imo : null,
    vesselEta: normalizeBerthTime(p.vesselEta ?? null),
    bargingType: p.bargingType ?? null,
    // An "included" barging has no price, whatever the model echoed.
    bargingUsd: p.bargingType === "LUMP_SUM" || p.bargingType === "PER_MT" ? nonNeg(p.bargingUsd) : null,
    otherFeesUsd: nonNeg(p.otherFeesUsd),
    paymentTerms: p.paymentTerms?.trim() || null,
    paymentDays: nonNeg(p.paymentDays),
    deliveryDelayHours: nonNeg(p.deliveryDelayHours),
    deliveryEarliest: normalizeBerthTime(p.deliveryEarliest ?? null),
    quoteValidityMinutes: nonNeg(p.quoteValidityMinutes),
    offerLines: lines.length > 0 ? lines : null,
  };
}
