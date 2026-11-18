import type { BunkerCalc, JitCalc, PortEventType } from "@maritime/shared";
import type { RecommendationRecord } from "./api.js";

/** €34,340 -> "€34k"; -59,601 -> "−€60k"; 820 -> "€820". */
export function eurShort(value: number, signed = false): string {
  const abs = Math.abs(value);
  const body = abs >= 1000 ? `€${Math.round(abs / 1000).toLocaleString("en-US")}k` : `€${Math.round(abs)}`;
  if (value < 0) return `−${body}`;
  return signed ? `+${body}` : body;
}

export function eurFull(value: number): string {
  const body = `€${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
  return value < 0 ? `−${body}` : body;
}

export const EVENT_LABELS: Record<PortEventType, string> = {
  BERTH_DELAY: "Berth delay",
  CONGESTION: "Congestion",
  CLOSURE: "Port closure",
  BUNKER_OFFER: "Bunker offer",
  NONE: "No event",
};

export function confidenceWord(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

export const isBunker = (rec: RecommendationRecord) => rec.actionType === "BUNKER_DETOUR";
export const jitCalc = (rec: RecommendationRecord) => rec.calc as JitCalc;
export const bunkerCalc = (rec: RecommendationRecord) => rec.calc as BunkerCalc;

export interface Headline {
  /** Small label above the sentence. */
  kicker: string;
  /** The action, in bold. */
  lead: string;
  /** Why it works (or why not). */
  body: string;
  /** The money, in bold. */
  money: string;
}

/** One plain sentence a reader gets in 5 seconds, built from computed fields only. */
export function headline(rec: RecommendationRecord): Headline {
  const vessel = rec.voyage?.vessel?.name ?? "the vessel";
  const dest = rec.voyage?.destPort?.name ?? "destination";

  if (isBunker(rec)) {
    const c = bunkerCalc(rec);
    const port = rec.portEvent?.port?.name ?? "the bunker port";
    const grade = rec.portEvent?.fuelGrade ?? "fuel";
    if (c.verdict === "WORTH_IT") {
      const speedUp = c.speedBunkerKn > c.v0 + 0.05 ? ` at ${c.speedBunkerKn.toFixed(1)} kn` : "";
      return {
        kicker: "Cheaper fuel on the way",
        lead: `Bunker ${Math.round(c.qtyT).toLocaleString("en-US")} t ${grade} at ${port}.`,
        body: `${c.detourNm.toFixed(0)} nm detour, +${c.extraHours.toFixed(0)} h, and ${vessel} still makes the ${dest} berth${speedUp}.`,
        money: `Net ${eurShort(c.netEur, true)}.`,
      };
    }
    const reason = rec.rejectReason?.replace(/^Not worth it:\s*/, "") ?? "it doesn't pay off";
    return {
      kicker: "Fuel offer declined",
      lead: `Skip the ${port} ${grade} offer.`,
      body: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`,
      money: `Net ${eurShort(c.netEur, true)}.`,
    };
  }

  const c = jitCalc(rec);
  const port = rec.portEvent?.port?.name ?? dest;
  const body =
    c.residualWaitHoursPlanB > 0.5
      ? `Still waits about ${c.residualWaitHoursPlanB.toFixed(0)} h off ${port}, ${(c.waitHoursPlanA - c.residualWaitHoursPlanB).toFixed(0)} h less than now.`
      : `Arrives right when the ${port} berth opens, with no waiting at anchor.`;
  return {
    kicker: "Arrive on time, not early",
    lead: `Slow ${vessel} from ${rec.currentSpeedKn.toFixed(1)} to ${rec.recommendedSpeedKn.toFixed(1)} kn.`,
    body,
    money: `Saves ${eurShort(rec.costSavedEur)}.`,
  };
}

/** What happened, in words: "Rotterdam berth delayed 24 h", "Fuel offer · Algeciras · $540/t". */
export function triggerText(rec: RecommendationRecord): string {
  const ev = rec.portEvent;
  const port = ev?.port?.name;
  if (!ev) return "";
  switch (ev.eventType) {
    case "BERTH_DELAY":
      return `${port ?? "Berth"} berth delayed${ev.delayHours != null ? ` ${ev.delayHours} h` : ""}`;
    case "CONGESTION":
      return `Congestion at ${port ?? "port"}${ev.delayHours != null ? `, +${ev.delayHours} h` : ""}`;
    case "CLOSURE":
      return `${port ?? "Port"} closed${ev.delayHours != null ? `, +${ev.delayHours} h` : ""}`;
    case "BUNKER_OFFER":
      return [
        "Fuel offer",
        port,
        ev.priceUsdPerT != null ? `$${ev.priceUsdPerT}/t` : null,
        ev.supplier ?? null,
      ]
        .filter(Boolean)
        .join(" · ");
    default:
      return EVENT_LABELS[ev.eventType];
  }
}
