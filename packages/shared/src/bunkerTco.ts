import { planBunkerOptions, stemQty } from "./bunkerPlan.js";
import { etsCostEur } from "./ets.js";
import type { BargingType, BunkerOfferDTO, BunkerOption, BunkerPlanInput, BunkerScreen, OfferTerms } from "./types.js";

/**
 * Total cost of a bunker offer, so offers can be compared like for like:
 * the invoice, plus what the call costs the voyage (extra fuel, delay risk,
 * port call), plus the price of worse terms (credit, supplier reliability,
 * optionally EU ETS). Pure; the browser re-runs it for the what-if sliders.
 */

export type Urgency = "LOW" | "NORMAL" | "HIGH";

/** Share of the charter value of each expected delay hour counted as risk. Hours late for the berth always count in full. */
export const URGENCY_DELAY_WEIGHT: Record<Urgency, number> = { LOW: 0.25, NORMAL: 0.5, HIGH: 1 };

export interface TcoAssumptions {
  /** Quantity the ship needs, t (clamped to each supplier's range). */
  stemQtyT: number;
  /** Time-charter (or demurrage) rate, USD/day. */
  charterUsdPerDay: number;
  urgency: Urgency;
  etsEnabled: boolean;
  /** EU Allowance price, €/t CO₂ (Settings → EUA price). */
  etsPriceEurPerT: number;
  /** Cost of money for comparing payment terms, % per year. */
  financeRatePct: number;
  /** Payment terms the others are measured against, days. */
  standardPaymentDays: number;
  /** Risk premium per reliability point below 10, % of the fuel bill. */
  reliabilityPctPerPoint: number;
}

export const DEFAULT_TCO: Omit<TcoAssumptions, "stemQtyT" | "charterUsdPerDay"> = {
  urgency: "NORMAL",
  // Same EU ETS model as the speed scenarios: on by default, priced at the Settings EUA price.
  etsEnabled: true,
  etsPriceEurPerT: 90,
  financeRatePct: 8,
  standardPaymentDays: 30,
  reliabilityPctPerPoint: 0.3,
};

/** Reliability assumed for a supplier with no history in the Supplier table (1–10). */
export const DEFAULT_RELIABILITY = 6;

export interface TcoOffer {
  id: string;
  supplier: string;
  portName: string;
  reliabilityScore: number;
  reliabilityKnown: boolean;
  terms: OfferTerms;
  planInput: BunkerPlanInput;
}

export interface TcoBreakdown {
  fuelUsd: number;
  bargingUsd: number;
  otherFeesUsd: number;
  portCallUsd: number;
  extraFuelUsd: number;
  delayRiskUsd: number;
  paymentTermsUsd: number;
  reliabilityUsd: number;
  etsUsd: number;
}

export const TCO_LABELS: Record<keyof TcoBreakdown, string> = {
  fuelUsd: "Fuel (price × quantity)",
  bargingUsd: "Barging",
  otherFeesUsd: "Other fees (overtime, agency)",
  portCallUsd: "Port call (our agency & dues)",
  extraFuelUsd: "Extra fuel for detour & speed",
  delayRiskUsd: "Delay risk (charter time)",
  paymentTermsUsd: "Payment terms (cost of credit)",
  reliabilityUsd: "Supplier reliability risk",
  etsUsd: "EU ETS on extra CO₂",
};

export interface TcoRow {
  offer: TcoOffer;
  screen: BunkerScreen;
  /** The best way to take the offer; null when the time check stopped the analysis. */
  option: BunkerOption | null;
  qtyT: number;
  /** Fits the schedule and the offer is still valid when the ship gets there. */
  feasible: boolean;
  breakdown: TcoBreakdown | null;
  totalUsd: number | null;
  effectiveUsdPerT: number | null;
  /** Assumptions made for this offer that a person should know about. */
  flags: string[];
  /** 1 = best. Offers that don't fit come last. */
  rank: number;
}

function bargingCost(type: BargingType | null, amount: number | null, qtyT: number): number {
  if (type === "LUMP_SUM") return amount ?? 0;
  if (type === "PER_MT") return (amount ?? 0) * qtyT;
  return 0;
}

export function assessOffer(offer: TcoOffer, a: TcoAssumptions): TcoRow {
  const planInput = { ...offer.planInput, stemQtyT: a.stemQtyT };
  const { screen, options } = planBunkerOptions(planInput);
  const { qtyT, adjusted } = stemQty(a.stemQtyT, planInput.offer.qtyMinT, planInput.offer.qtyMaxT);
  const t = offer.terms;
  const flags: string[] = [];
  if (adjusted) flags.push(`stem set to ${qtyT.toLocaleString("en-US")} t to fit the supplier's range`);
  if (t.bargingType === null) flags.push("barging not stated: assumed included");
  if (t.paymentDays === null) flags.push(`payment terms not stated: assumed ${a.standardPaymentDays} days`);
  if (!offer.reliabilityKnown) flags.push(`no history with this supplier: reliability assumed ${offer.reliabilityScore}/10`);

  const option = options[0] ?? null;
  if (!screen.passed || !option) {
    return { offer, screen, option: null, qtyT, feasible: false, breakdown: null, totalUsd: null, effectiveUsdPerT: null, flags, rank: 0 };
  }

  const c = option.calc;
  const usdPerEur = 1 / planInput.usdEurRate;
  const hourUsd = a.charterUsdPerDay / 24;
  const fuelUsd = planInput.offer.priceUsdPerT * qtyT;
  const bargingUsd = bargingCost(t.bargingType, t.bargingUsd, qtyT);
  const otherFeesUsd = t.otherFeesUsd ?? 0;
  const invoiceUsd = fuelUsd + bargingUsd + otherFeesUsd;
  const days = t.paymentDays ?? a.standardPaymentDays;
  const score = Math.min(10, Math.max(1, offer.reliabilityScore));
  const breakdown: TcoBreakdown = {
    fuelUsd,
    bargingUsd,
    otherFeesUsd,
    portCallUsd: c.portFeeEur * usdPerEur,
    extraFuelUsd: c.extraFuelT * c.refPriceEurPerT * usdPerEur,
    delayRiskUsd: (c.delayHours ?? 0) * hourUsd * URGENCY_DELAY_WEIGHT[a.urgency] + c.lateHours * hourUsd,
    paymentTermsUsd: (invoiceUsd * (a.financeRatePct / 100) * (a.standardPaymentDays - days)) / 365,
    reliabilityUsd: fuelUsd * (a.reliabilityPctPerPoint / 100) * (10 - score),
    etsUsd: a.etsEnabled
      ? etsCostEur(c.extraCo2T, {
          euaPriceEurPerT: a.etsPriceEurPerT,
          year: new Date(planInput.now).getUTCFullYear(),
          voyageScope: planInput.etsScope ?? 1,
        }) * usdPerEur
      : 0,
  };
  const totalUsd = Object.values(breakdown).reduce((s, v) => s + v, 0);
  if (c.lateHours > 1e-6) flags.push(`reaches the berth ${Math.round(c.lateHours * 60)} min late (within the tolerance)`);
  return {
    offer,
    screen,
    option,
    qtyT,
    feasible: c.arrivalOk && c.offerValidAtArrival,
    breakdown,
    totalUsd,
    effectiveUsdPerT: totalUsd / qtyT,
    flags,
    rank: 0,
  };
}

/** Assess every offer and rank them: workable ones by effective $/t, then the rest. */
export function compareOffers(offers: TcoOffer[], a: TcoAssumptions): TcoRow[] {
  const rows = offers.map((o) => assessOffer(o, a));
  rows.sort((x, y) => {
    if (x.feasible !== y.feasible) return x.feasible ? -1 : 1;
    if (x.effectiveUsdPerT === null || y.effectiveUsdPerT === null) return 0;
    return x.effectiveUsdPerT - y.effectiveUsdPerT;
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

const usd = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const perT = (v: number) => `$${Math.abs(v).toFixed(2)}/t`;
const h = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} h`;

function bargingWords(t: OfferTerms, qtyT: number): string {
  if (t.bargingType === "LUMP_SUM") return `${usd(t.bargingUsd ?? 0)} barging on top`;
  if (t.bargingType === "PER_MT") return `${usd(bargingCost(t.bargingType, t.bargingUsd, qtyT))} barging on top`;
  return "barging included";
}

function delayWords(r: TcoRow): string {
  const d = r.option?.calc.delayHours ?? 0;
  return d > 0 ? `barge ${h(d)} after arrival` : "barge on arrival";
}

/** One plain sentence per cost line where `win` beats `other`, biggest first. */
function drivers(win: TcoRow, other: TcoRow): string[] {
  const w = win.breakdown!;
  const o = other.breakdown!;
  const out: Array<{ gain: number; text: string }> = [];
  const add = (gain: number, text: string) => {
    if (gain > 250) out.push({ gain, text });
  };
  add(o.bargingUsd - w.bargingUsd, `${bargingWords(win.offer.terms, win.qtyT)} vs ${bargingWords(other.offer.terms, other.qtyT)} (${usd(o.bargingUsd - w.bargingUsd)})`);
  // The ETS here is on the extra fuel itself, so it belongs to the same reason.
  const etsGain = o.etsUsd - w.etsUsd;
  const fuelAndDelay = o.extraFuelUsd - w.extraFuelUsd + (o.delayRiskUsd - w.delayRiskUsd) + etsGain;
  add(
    fuelAndDelay,
    `${delayWords(win)} vs ${delayWords(other)}: ${usd(fuelAndDelay)} less in extra fuel${Math.abs(etsGain) > 1 ? " (incl. EU ETS)" : ""} to make up the time and delay risk`
  );
  add(o.reliabilityUsd - w.reliabilityUsd, `reliability ${win.offer.reliabilityScore}/10 vs ${other.offer.reliabilityScore}/10 (${usd(o.reliabilityUsd - w.reliabilityUsd)} less supply risk)`);
  add(
    o.paymentTermsUsd - w.paymentTermsUsd,
    `${win.offer.terms.paymentDays ?? 30}-day vs ${other.offer.terms.paymentDays ?? 30}-day credit (${usd(o.paymentTermsUsd - w.paymentTermsUsd)})`
  );
  add(o.otherFeesUsd - w.otherFeesUsd, `${usd(o.otherFeesUsd - w.otherFeesUsd)} less in overtime/agency fees`);
  add(o.fuelUsd - w.fuelUsd, `${perT((o.fuelUsd - w.fuelUsd) / win.qtyT)} cheaper fuel`);
  return out.sort((x, y) => y.gain - x.gain).slice(0, 3).map((x) => x.text);
}

export interface TcoExplanation {
  headline: string;
  reasons: string[];
  warnings: string[];
}

/**
 * The recommendation in plain English, built only from the computed numbers
 * (no model call, so it updates instantly with the sliders and never invents figures).
 */
export function explainComparison(rows: TcoRow[]): TcoExplanation {
  const feasible = rows.filter((r) => r.feasible);
  const warnings = rows
    .filter((r) => !r.screen.passed)
    .map((r) =>
      r.screen.stoppedBecause === "EXPIRED"
        ? `${r.offer.supplier} (${r.offer.portName}) not analysed further: the ship can't get there before the offer expires.`
        : `${r.offer.supplier} (${r.offer.portName}) not analysed further: the call needs ${h(r.screen.neededHours)} but the ship has ${h(Math.max(0, r.screen.slackHours))} to spare.`
    );
  for (const r of rows) {
    if (r.screen.passed && !r.feasible) warnings.push(`${r.offer.supplier} (${r.offer.portName}) would miss the berth or the offer's expiry.`);
  }

  if (feasible.length === 0) {
    return {
      headline: rows.length === 0 ? "No offers to compare yet." : `None of the ${rows.length} offers fits the ship's schedule.`,
      reasons: [],
      warnings,
    };
  }

  const best = feasible[0];
  const label = (r: TcoRow) => `${r.offer.supplier} (${r.offer.portName})`;
  const cheapestOnPaper = feasible.reduce((m, r) => (r.offer.planInput.offer.priceUsdPerT < m.offer.planInput.offer.priceUsdPerT ? r : m));
  const bestPrice = best.offer.planInput.offer.priceUsdPerT;

  if (feasible.length === 1) {
    return {
      headline: `${label(best)} is the only offer that fits: ${perT(best.effectiveUsdPerT!)} all-in.`,
      reasons: [],
      warnings,
    };
  }

  if (cheapestOnPaper !== best && cheapestOnPaper.offer.planInput.offer.priceUsdPerT < bestPrice) {
    const saving = cheapestOnPaper.totalUsd! - best.totalUsd!;
    return {
      headline:
        `${label(best)} is ${perT(bestPrice - cheapestOnPaper.offer.planInput.offer.priceUsdPerT)} dearer on paper than ` +
        `${label(cheapestOnPaper)}, but ${usd(saving)} cheaper overall (${perT(best.effectiveUsdPerT!)} vs ${perT(cheapestOnPaper.effectiveUsdPerT!)} all-in).`,
      reasons: drivers(best, cheapestOnPaper),
      warnings,
    };
  }

  const runnerUp = feasible[1];
  return {
    headline:
      `${label(best)} is the best buy: ${perT(best.effectiveUsdPerT!)} all-in, ` +
      `${usd(runnerUp.totalUsd! - best.totalUsd!)} less than ${label(runnerUp)}.`,
    reasons: drivers(best, runnerUp),
    warnings,
  };
}

/** The comparison input for an offer from the API (null when it has no plan to compare). */
export function tcoOfferFromDTO(o: BunkerOfferDTO): TcoOffer | null {
  if (!o.plan) return null;
  return {
    id: o.recommendationId,
    supplier: o.supplier.name,
    portName: o.port.name,
    reliabilityScore: o.supplier.reliabilityScore,
    reliabilityKnown: o.supplier.known,
    terms: o.terms,
    planInput: o.plan.input,
  };
}
