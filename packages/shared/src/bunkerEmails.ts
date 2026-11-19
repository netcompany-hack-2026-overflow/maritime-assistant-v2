import type { BunkerDraftContext, BunkerOption, BunkerScreen, EmailDraftSpec } from "./types.js";

/**
 * Reply emails for a bunker offer, written from templates and the computed
 * numbers only: no model call, so no tokens and no invented figures. A person
 * reads them, edits if needed and sends one.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-20T14:05:00Z" -> "20 Nov 2026 14:05 UTC" */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function reSubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

function greeting(ctx: BunkerDraftContext): string {
  return ctx.supplierName ? `Dear ${ctx.supplierName} team,` : "Dear Sirs,";
}

function signOff(ctx: BunkerDraftContext): string {
  return `Best regards,\n${ctx.senderName}`;
}

const tonnes = (t: number) => Math.round(t).toLocaleString("en-US");
const price = (p: number) => p.toFixed(2);
const grade = (ctx: BunkerDraftContext) => ctx.fuelGrade ?? "fuel";

function feasible(o: BunkerOption): boolean {
  return o.calc.arrivalOk && o.calc.offerValidAtArrival;
}

function acceptDraft(ctx: BunkerDraftContext, o: BunkerOption): EmailDraftSpec {
  const c = o.calc;
  const stop = c.portHours + (c.delayHours ?? 0);
  const buffer =
    o.key === "KEEP_SPEED" && c.waitHoursBunker >= 1
      ? `\nThe vessel will have about ${Math.round(c.waitHoursBunker)} h in hand, so a short wait for the barge can be accommodated.\n`
      : "";
  const validity = ctx.validUntil ? ` before your offer expires (${formatUtc(ctx.validUntil)})` : "";
  return {
    kind: "ACCEPT",
    optionKey: o.key,
    toAddr: ctx.supplierAddr,
    subject: `${reSubject(ctx.offerSubject)} - confirmed ${tonnes(c.qtyT)} mt ${grade(ctx)}, ETA ${formatUtc(c.etaAtBunker)}`,
    body: [
      greeting(ctx),
      "",
      `Thank you for your offer. We confirm the following stem for ${ctx.vesselName} (IMO ${ctx.vesselImo}):`,
      "",
      `  Product:   ${grade(ctx)}`,
      `  Quantity:  ${tonnes(c.qtyT)} mt`,
      `  Price:     USD ${price(ctx.priceUsdPerT)}/mt`,
      `  Port:      ${ctx.portName} (${ctx.portUnlocode})`,
      `  Vessel ETA ${ctx.portName}: ${formatUtc(c.etaAtBunker)}`,
      `  Expected time alongside: about ${Math.round(stop)} h`,
      "",
      "All other terms as per your offer.",
      buffer,
      `Please send your formal confirmation with the barge nomination and delivery time${validity}.`,
      "",
      signOff(ctx),
    ].join("\n"),
  };
}

/** Counter at a round price at least USD 5/t under break-even, so the call actually pays. */
export function counterPriceUsdPerT(breakEvenUsdPerT: number): number {
  return Math.floor((breakEvenUsdPerT - 5) / 5) * 5;
}

function counterDraft(ctx: BunkerDraftContext, o: BunkerOption, counter: number): EmailDraftSpec {
  const c = o.calc;
  const validity = ctx.validUntil ? ` before ${formatUtc(ctx.validUntil)}` : "";
  return {
    kind: "COUNTER",
    optionKey: o.key,
    toAddr: ctx.supplierAddr,
    subject: `${reSubject(ctx.offerSubject)} - counter USD ${price(counter)}/mt`,
    body: [
      greeting(ctx),
      "",
      `Thank you for your offer of ${grade(ctx)} at ${ctx.portName} for ${ctx.vesselName} (IMO ${ctx.vesselImo}).`,
      "",
      `At USD ${price(ctx.priceUsdPerT)}/mt the call does not work for this voyage. We could proceed at ` +
        `USD ${price(counter)}/mt for ${tonnes(c.qtyT)} mt, with the vessel arriving ${formatUtc(c.etaAtBunker)}.`,
      "",
      `Please let us know if you can meet this level${validity}.`,
      "",
      signOff(ctx),
    ].join("\n"),
  };
}

function declineDraft(ctx: BunkerDraftContext, screen: BunkerScreen): EmailDraftSpec {
  const why =
    screen.stoppedBecause === "TIME"
      ? "The call does not fit the vessel's schedule, so we"
      : screen.stoppedBecause === "EXPIRED"
        ? `The vessel cannot reach ${ctx.portName} before the offer expires, so we`
        : "After comparing it with our other options, we";
  return {
    kind: "DECLINE",
    optionKey: null,
    toAddr: ctx.supplierAddr,
    subject: reSubject(ctx.offerSubject),
    body: [
      greeting(ctx),
      "",
      `Thank you for your offer of ${grade(ctx)} at ${ctx.portName} for ${ctx.vesselName}. ${why} will not take it up this time.`,
      "",
      "We appreciate the quote and look forward to your next offer.",
      "",
      signOff(ctx),
    ].join("\n"),
  };
}

/**
 * The replies a person can choose from:
 * - one acceptance per workable option (each with that option's ETA at the bunker port),
 * - a counter-offer when the best workable option loses money at the offered price,
 * - always a polite decline.
 * An offer the time check stopped gets only the decline.
 */
export function draftBunkerReplies(plan: { screen: BunkerScreen; options: BunkerOption[]; context: BunkerDraftContext }): EmailDraftSpec[] {
  const ctx = plan.context;
  const drafts: EmailDraftSpec[] = [];
  const workable = plan.options.filter(feasible);
  for (const o of workable) drafts.push(acceptDraft(ctx, o));
  const best = workable[0];
  if (best && best.calc.netEur <= 0 && best.breakEvenUsdPerT !== null) {
    const counter = counterPriceUsdPerT(best.breakEvenUsdPerT);
    if (counter > 0 && counter < ctx.priceUsdPerT) drafts.push(counterDraft(ctx, best, counter));
  }
  drafts.push(declineDraft(ctx, plan.screen));
  return drafts;
}
