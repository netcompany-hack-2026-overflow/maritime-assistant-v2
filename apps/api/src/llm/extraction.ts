import { portEventExtractionSchema, type PortEventExtraction } from "@maritime/shared";

/** System prompt shared by the real-LLM providers (OpenAI, Anthropic). */
export const EXTRACTION_SYSTEM_PROMPT =
  "You extract structured port-event data from maritime port-agent emails. " +
  "Reply with ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape: " +
  '{"eventType":"BERTH_DELAY"|"CONGESTION"|"CLOSURE"|"NONE","portName":string|null,' +
  '"portUnlocode":string|null,"vesselNameMentioned":string|null,"delayHours":number|null,' +
  '"newBerthTime":string|null,"confidence":number (0-1),' +
  '"sourceSpans":[{"field":string,"text":string}]}. ' +
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
  return {
    ...parsed,
    portName: normalizePortName(parsed.portName),
    portUnlocode: parsed.portUnlocode ? parsed.portUnlocode.replace(/\s+/g, "").toUpperCase() : null,
    newBerthTime: normalizeBerthTime(parsed.newBerthTime),
  };
}
