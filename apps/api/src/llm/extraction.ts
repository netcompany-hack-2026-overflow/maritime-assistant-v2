import { portEventExtractionSchema, type PortEventExtraction } from "@maritime/shared";

/** System prompt shared by the real-LLM providers (OpenAI, Anthropic). */
export const EXTRACTION_SYSTEM_PROMPT =
  "You extract structured port-event data from maritime port-agent emails. " +
  "Reply with ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape: " +
  '{"eventType":"BERTH_DELAY"|"CONGESTION"|"CLOSURE"|"BUNKER_OFFER"|"NONE","portName":string|null,' +
  '"portUnlocode":string|null,"vesselNameMentioned":string|null,"delayHours":number|null,' +
  '"newBerthTime":string|null,"fuelGrade":string|null,"priceUsdPerT":number|null,' +
  '"qtyMinT":number|null,"qtyMaxT":number|null,"validUntil":string|null,"supplier":string|null,' +
  '"confidence":number (0-1),"sourceSpans":[{"field":string,"text":string}]}. ' +
  "BUNKER_OFFER is a fuel supplier offering a specific fuel delivery at a named port: portName is the " +
  "port where the fuel is supplied (not the ship's destination), fuelGrade e.g. VLSFO/MGO, " +
  "priceUsdPerT the price in US dollars per metric ton, qtyMinT/qtyMaxT the offered quantity in " +
  "metric tons (both equal for a single figure), validUntil when the offer expires (same format as " +
  "newBerthTime), supplier the company offering. A price list, market report or newsletter with no " +
  'specific offer is "NONE". For other event types leave the bunker fields null. ' +
  'portName is the plain port name only, e.g. "Rotterdam", never "Port of Rotterdam". ' +
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
    fuelGrade: bunker ? (parsed.fuelGrade?.trim().toUpperCase() || null) : null,
    priceUsdPerT: bunker ? (parsed.priceUsdPerT ?? null) : null,
    qtyMinT: bunker ? (parsed.qtyMinT ?? parsed.qtyMaxT ?? null) : null,
    qtyMaxT: bunker ? (parsed.qtyMaxT ?? parsed.qtyMinT ?? null) : null,
    validUntil: bunker ? normalizeBerthTime(parsed.validUntil ?? null) : null,
    supplier: bunker ? (parsed.supplier?.trim() || null) : null,
  };
}
