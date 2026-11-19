import type { CharterPartyTerms } from "./charterParty.js";

/**
 * Laytime / demurrage for the discharge port, simplified to what changes
 * between arrival scenarios:
 *
 *   laytime starts  = earlier of (arrival + NOR turn time) and berthing, when
 *                     waiting time counts (WIBON); otherwise at berthing
 *   laytime used    = (berthing − laytime start)⁺ + cargo-operations hours
 *   demurrage       = (used − allowed)⁺ × rate / 24
 *   despatch        = (allowed − used)⁺ × despatch rate / 24
 *
 * Pure function, no I/O. Exceptions, holidays, shifting time and laycan are
 * out of scope (see README "Assumptions").
 */
export interface LaytimeAssessment {
  laytimeStartAt: string;
  /** Hours of waiting for the berth that count as laytime. */
  waitingCountedHours: number;
  opsHours: number;
  usedHours: number;
  allowedHours: number;
  withinLaytime: boolean;
  demurrageHours: number;
  demurrageAmount: number;
  despatchHours: number;
  despatchAmount: number;
  currency: string;
}

const H = 3_600_000;

export function assessLaytime(
  terms: CharterPartyTerms,
  arrivalAt: Date,
  berthAt: Date,
  opsHours: number
): LaytimeAssessment | null {
  if (terms.laytimeHours == null) return null;
  const nor = terms.norNoticeHours ?? 6;
  // A ship that arrives after the berth time berths on arrival.
  const berthing = new Date(Math.max(berthAt.getTime(), arrivalAt.getTime()));
  const start =
    terms.waitingTimeCounts === true
      ? new Date(Math.min(arrivalAt.getTime() + nor * H, berthing.getTime()))
      : berthing;
  const waitingCountedHours = Math.max(0, (berthing.getTime() - start.getTime()) / H);
  const usedHours = waitingCountedHours + opsHours;
  const allowedHours = terms.laytimeHours;
  const demurrageHours = Math.max(0, usedHours - allowedHours);
  const despatchHours = Math.max(0, allowedHours - usedHours);
  return {
    laytimeStartAt: start.toISOString(),
    waitingCountedHours,
    opsHours,
    usedHours,
    allowedHours,
    withinLaytime: demurrageHours === 0,
    demurrageHours,
    demurrageAmount: (demurrageHours / 24) * (terms.demurrageRatePerDay ?? 0),
    despatchHours,
    despatchAmount: (despatchHours / 24) * (terms.despatchRatePerDay ?? 0),
    currency: terms.currency ?? "USD",
  };
}

export type JitCoverageStatus = "NOT_APPLICABLE" | "COVERED" | "NEEDS_INSTRUCTION" | "NOT_COVERED" | "NO_CHARTER_PARTY";

export interface JitCoverage {
  status: JitCoverageStatus;
  note: string;
}

/** Does the CP's JIT clause cover slowing down for this scenario? */
export function assessJitCoverage(
  terms: CharterPartyTerms | null,
  speedReduced: boolean
): JitCoverage {
  if (!speedReduced) {
    return { status: "NOT_APPLICABLE", note: "Χωρίς μείωση ταχύτητας· η υποχρέωση utmost despatch τηρείται." };
  }
  if (!terms) {
    return { status: "NO_CHARTER_PARTY", note: "Δεν υπάρχει ναυλοσύμφωνο: ανεβάστε το για να ελεγχθεί η μείωση ταχύτητας με τους όρους του." };
  }
  const c = terms.jitClause;
  const name = c.name ?? "τη ρήτρα JIT";
  if (!c.present || c.speedReductionPermitted === false) {
    return {
      status: "NOT_COVERED",
      note: "Χωρίς ρήτρα JIT: ισχύει η υποχρέωση utmost despatch. Πάρτε γραπτή συμφωνία των ναυλωτών πριν μειώσετε ταχύτητα.",
    };
  }
  if (c.requiresChartererInstruction) {
    return {
      status: "NEEDS_INSTRUCTION",
      note: `Καλύπτεται από ${name}, με εντολή των ναυλωτών. Στείλτε την ειδοποίηση και πάρτε επιβεβαίωση πριν αλλάξει η ταχύτητα.`,
    };
  }
  return { status: "COVERED", note: `Καλύπτεται από ${name}: το πλοίο μπορεί να προσαρμόσει την ταχύτητα για να φτάσει στην ώρα πρόσδεσης.` };
}
