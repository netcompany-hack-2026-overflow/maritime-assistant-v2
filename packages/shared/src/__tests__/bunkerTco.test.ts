import { describe, expect, it } from "vitest";
import { DEFAULT_TCO, assessOffer, compareOffers, explainComparison, type TcoAssumptions, type TcoOffer } from "../bunkerTco.js";
import { draftBunkerReplies, counterPriceUsdPerT } from "../bunkerEmails.js";
import { planBunkerOptions } from "../bunkerPlan.js";
import type { BunkerDraftContext, BunkerPlanInput, OfferTerms } from "../types.js";

const H = 3_600_000;
const NOW = new Date("2026-11-20T00:00:00Z");

function planInput(over: Partial<BunkerPlanInput> = {}, slackHours = 24): BunkerPlanInput {
  return {
    now: NOW.toISOString(),
    deadline: new Date(NOW.getTime() + (1700 / 14 + slackHours) * H).toISOString(),
    remainingNm: 1700,
    offRouteNm: 5,
    alongNm: 320,
    shipPosition: { lat: 37, lon: 0 },
    turnOff: { lat: 36, lon: -5.3 },
    bunkerPort: { lat: 36.12, lon: -5.44 },
    destination: { lat: 51.95, lon: 4.15 },
    vessel: { speedKn: 14, designSpeedKn: 14, minSpeedKn: 9, fuelTPerDayAtDesign: 40, auxFuelTPerDay: 3 },
    offer: { priceUsdPerT: 530, qtyMinT: 750, qtyMaxT: 1000, validUntil: null },
    stemQtyT: 800,
    refPriceEurPerT: 600,
    usdEurRate: 0.92,
    stdPortHours: 8,
    stdQtyT: 800,
    pumpRateTPerH: 250,
    portFeeEur: 5000,
    co2Factor: 3.114,
    delays: [],
    toleranceHours: 0.5,
    ...over,
  };
}

const terms = (over: Partial<OfferTerms> = {}): OfferTerms => ({
  vesselImo: "9000001",
  vesselEta: null,
  bargingType: "INCLUDED",
  bargingUsd: null,
  otherFeesUsd: null,
  paymentTerms: "30 days",
  paymentDays: 30,
  deliveryDelayHours: 0,
  deliveryEarliest: null,
  quoteValidityMinutes: null,
  quoteFirmUntil: null,
  lines: [],
  ...over,
});

const delay = (hours: number) => [{ source: "SUPPLIER_WINDOW" as const, hours, note: `ETA+${hours} h` }];

/** The demo's trap: cheapest on paper, but barging extra, a 12 h barge wait and a weak supplier. */
const trap: TcoOffer = {
  id: "trap",
  supplier: "Rock Marine Fuels",
  portName: "Gibraltar",
  reliabilityScore: 5,
  reliabilityKnown: true,
  terms: terms({ bargingType: "LUMP_SUM", bargingUsd: 4500, deliveryDelayHours: 12 }),
  planInput: planInput({ offer: { priceUsdPerT: 526, qtyMinT: 750, qtyMaxT: 1000, validUntil: null }, delays: delay(12) }),
};
const balanced: TcoOffer = {
  id: "balanced",
  supplier: "Strait Bunkering Ltd",
  portName: "Algeciras",
  reliabilityScore: 9,
  reliabilityKnown: true,
  terms: terms(),
  planInput: planInput({ offRouteNm: 10, offer: { priceUsdPerT: 531, qtyMinT: 750, qtyMaxT: 1000, validUntil: null } }),
};
const urgent: TcoOffer = {
  id: "urgent",
  supplier: "Ceuta Oil Trading",
  portName: "Ceuta",
  reliabilityScore: 7,
  reliabilityKnown: true,
  terms: terms({ paymentDays: 15, deliveryDelayHours: 2 }),
  planInput: planInput({ offRouteNm: 8, offer: { priceUsdPerT: 527, qtyMinT: 800, qtyMaxT: 1000, validUntil: null }, delays: delay(2) }),
};

const A: TcoAssumptions = { ...DEFAULT_TCO, stemQtyT: 800, charterUsdPerDay: 18_000 };

describe("assessOffer", () => {
  it("adds the hidden costs to the invoice", () => {
    const r = assessOffer(trap, A);
    expect(r.feasible).toBe(true);
    expect(r.breakdown!.fuelUsd).toBe(526 * 800);
    expect(r.breakdown!.bargingUsd).toBe(4500);
    expect(r.breakdown!.delayRiskUsd).toBeCloseTo(12 * (18_000 / 24) * 0.5, 6);
    expect(r.breakdown!.reliabilityUsd).toBeCloseTo(526 * 800 * 0.003 * 5, 6);
    expect(r.effectiveUsdPerT).toBeGreaterThan(526);
  });

  it("per-tonne barging scales with the stem", () => {
    const r = assessOffer({ ...balanced, terms: terms({ bargingType: "PER_MT", bargingUsd: 3 }) }, A);
    expect(r.breakdown!.bargingUsd).toBe(2400);
  });

  it("shorter credit costs money, longer credit saves it", () => {
    expect(assessOffer(urgent, A).breakdown!.paymentTermsUsd).toBeGreaterThan(0);
    expect(assessOffer({ ...urgent, terms: terms({ paymentDays: 60 }) }, A).breakdown!.paymentTermsUsd).toBeLessThan(0);
  });

  it("EU ETS only counts when switched on, with the voyage's scope and the year's phase-in", () => {
    expect(assessOffer(balanced, { ...A, etsEnabled: false }).breakdown!.etsUsd).toBe(0);
    const on = assessOffer(balanced, { ...A, etsEnabled: true, etsPriceEurPerT: 90 });
    const extraCo2 = on.option!.calc.extraCo2T;
    // 2026: 100% phase-in; Piraeus → Rotterdam is EU to EU, scope 1.
    expect(on.breakdown!.etsUsd).toBeCloseTo((extraCo2 * 90) / 0.92, 6);
    const halfScope = { ...balanced, planInput: { ...balanced.planInput, etsScope: 0.5 } };
    expect(assessOffer(halfScope, { ...A, etsEnabled: true, etsPriceEurPerT: 90 }).breakdown!.etsUsd).toBeCloseTo((extraCo2 * 45) / 0.92, 6);
  });

  it("flags what it had to assume", () => {
    const r = assessOffer({ ...balanced, reliabilityKnown: false, reliabilityScore: 6, terms: terms({ bargingType: null, paymentDays: null }) }, A);
    expect(r.flags.join(" ")).toMatch(/το barging δεν αναφέρεται/);
    expect(r.flags.join(" ")).toMatch(/οι όροι πληρωμής δεν αναφέρονται/);
    expect(r.flags.join(" ")).toMatch(/χωρίς ιστορικό/);
  });

  it("an offer the time check stops gets no cost breakdown", () => {
    const r = assessOffer({ ...balanced, planInput: planInput({}, 0) }, A);
    expect(r).toMatchObject({ feasible: false, breakdown: null, totalUsd: null, option: null });
  });
});

describe("compareOffers + explainComparison", () => {
  it("the cheapest offer on paper is not the best buy", () => {
    const rows = compareOffers([trap, balanced, urgent], A);
    expect(rows[0].offer.id).toBe("balanced");
    expect(rows.find((r) => r.offer.id === "trap")!.rank).toBe(3);
    const e = explainComparison(rows);
    expect(e.headline).toMatch(/^Η Strait Bunkering Ltd \(Algeciras\) είναι \$5\.00\/t ακριβότερη στο χαρτί από την Rock Marine Fuels \(Gibraltar\), αλλά \$[\d,]+ φθηνότερη συνολικά/);
    expect(e.reasons.join(" ")).toMatch(/barging μέσα στην τιμή έναντι \$4,500 barging επιπλέον/);
    expect(e.reasons.join(" ")).toMatch(/barge με την άφιξη έναντι barge 12 h μετά την άφιξη/);
  });

  it("a higher charter rate widens the gap to the slow-barge offer", () => {
    const gap = (charter: number) => {
      const rows = compareOffers([trap, balanced], { ...A, charterUsdPerDay: charter });
      return rows[1].totalUsd! - rows[0].totalUsd!;
    };
    expect(gap(40_000)).toBeGreaterThan(gap(10_000));
  });

  it("urgency weighs delay risk", () => {
    const risk = (urgency: TcoAssumptions["urgency"]) => assessOffer(trap, { ...A, urgency }).breakdown!.delayRiskUsd;
    expect(risk("LOW")).toBeLessThan(risk("NORMAL"));
    expect(risk("HIGH")).toBe(2 * risk("NORMAL"));
  });

  it("offers that don't fit go last, with a warning instead of numbers", () => {
    const stopped = { ...urgent, id: "stopped", planInput: planInput({}, 0) };
    const rows = compareOffers([stopped, balanced], A);
    expect(rows.map((r) => r.offer.id)).toEqual(["balanced", "stopped"]);
    const e = explainComparison(rows);
    expect(e.headline).toMatch(/η μόνη προσφορά που χωράει/);
    expect(e.warnings[0]).toMatch(/δεν αναλύθηκε περαιτέρω, η προσέγγιση χρειάζεται/);
  });

  it("says so when nothing fits", () => {
    const e = explainComparison(compareOffers([{ ...balanced, planInput: planInput({}, 0) }], A));
    expect(e.headline).toBe("Καμία από τις 1 προσφορές δεν χωράει στο πρόγραμμα του πλοίου.");
  });
});

describe("draftBunkerReplies", () => {
  const ctx: BunkerDraftContext = {
    supplierName: "Strait Bunkering Ltd",
    supplierAddr: "trading@strait-bunkering.example",
    offerSubject: "Bunker offer - VLSFO at Algeciras",
    vesselName: "MV Aegean Star",
    vesselImo: "9000001",
    portName: "Algeciras",
    portUnlocode: "ESALG",
    fuelGrade: "VLSFO",
    priceUsdPerT: 531,
    validUntil: null,
    senderName: "Tidewise Operations",
  };

  it("a paying offer: one acceptance per option, plus a decline; no counter", () => {
    const plan = planBunkerOptions(balanced.planInput);
    const drafts = draftBunkerReplies({ ...plan, context: ctx });
    expect(drafts.map((d) => `${d.kind}:${d.optionKey}`)).toEqual(["ACCEPT:ECO", "ACCEPT:KEEP_SPEED", "DECLINE:null"]);
    expect(drafts[0].toAddr).toBe("trading@strait-bunkering.example");
    expect(drafts[0].subject).toMatch(/^Re: Bunker offer - VLSFO at Algeciras - confirmed 800 mt VLSFO, ETA /);
    expect(drafts[0].body).toContain("USD 531.00/mt");
    expect(drafts[1].body).toMatch(/about \d+ h in hand/);
  });

  it("an offer that loses money also gets a counter below break-even", () => {
    const dear = planInput({ offer: { priceUsdPerT: 700, qtyMinT: null, qtyMaxT: null, validUntil: null } });
    const plan = planBunkerOptions(dear);
    const drafts = draftBunkerReplies({ ...plan, context: { ...ctx, priceUsdPerT: 700 } });
    const counter = drafts.find((d) => d.kind === "COUNTER")!;
    const expected = counterPriceUsdPerT(plan.options[0].breakEvenUsdPerT!);
    expect(expected).toBeLessThan(700);
    expect(counter.body).toContain(`USD ${expected.toFixed(2)}/mt`);
    expect(counter.subject).toBe(`Re: Bunker offer - VLSFO at Algeciras - counter USD ${expected.toFixed(2)}/mt`);
  });

  it("an offer the time check stopped only gets a decline that says why", () => {
    const plan = planBunkerOptions(planInput({}, 0));
    const drafts = draftBunkerReplies({ ...plan, context: { ...ctx, offerSubject: "RE: offer" } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "DECLINE", subject: "RE: offer" });
    expect(drafts[0].body).toMatch(/does not fit the vessel's schedule/);
  });
});
