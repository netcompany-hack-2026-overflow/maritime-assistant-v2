import { calculateBunker, repriceBunker, type BunkerInput } from "./bunker.js";
import type {
  BunkerCalc,
  BunkerOption,
  BunkerPlan,
  BunkerPlanInput,
  BunkerScreen,
  BunkerWaypoint,
} from "./types.js";

const H = 3_600_000;

/** The KEEP_SPEED option is only shown when it differs from ECO by at least this much, kn. */
const MIN_SPEED_DIFFERENCE_KN = 0.3;

/**
 * Time alongside for a quantity. The standard stem takes stdPortHours (approach,
 * hoses, sampling, paperwork and pumping); every tonne more or less adds or
 * saves pumping time at pumpRateTPerH. Never less than the pumping itself + 1 h.
 */
export function bunkeringHours(qtyT: number, stdQtyT: number, stdPortHours: number, pumpRateTPerH: number): number {
  const scaled = stdPortHours + (qtyT - stdQtyT) / pumpRateTPerH;
  return Math.max(qtyT / pumpRateTPerH + 1, scaled);
}

/** The stem the supplier can actually deliver: what we want, clamped to the offered range. */
export function stemQty(wantedT: number, qtyMinT: number | null, qtyMaxT: number | null): { qtyT: number; adjusted: boolean } {
  let qtyT = wantedT;
  if (qtyMinT !== null && qtyT < qtyMinT) qtyT = qtyMinT;
  if (qtyMaxT !== null && qtyT > qtyMaxT) qtyT = qtyMaxT;
  return { qtyT, adjusted: qtyT !== wantedT };
}

/** Expected wait at the bunker port: the worst of the known causes (they overlap rather than add up). */
export function expectedDelayHours(input: Pick<BunkerPlanInput, "delays">): number {
  return input.delays.reduce((max, d) => Math.max(max, d.hours), 0);
}

/**
 * The time check that decides whether an offer is worth analysing at all.
 * Optimistic on purpose (design speed): if the bunker call doesn't fit even
 * then, no speed or option will make it fit, so nothing further is computed.
 */
export function screenBunkerOffer(input: BunkerPlanInput): BunkerScreen {
  const now = new Date(input.now).getTime();
  const deadline = new Date(input.deadline).getTime();
  const { designSpeedKn } = input.vessel;
  const { qtyT } = stemQty(input.stemQtyT, input.offer.qtyMinT, input.offer.qtyMaxT);

  const hoursToDeadline = (deadline - now) / H;
  const slackHours = hoursToDeadline - input.remainingNm / designSpeedKn;
  const bunkering = bunkeringHours(qtyT, input.stdQtyT, input.stdPortHours, input.pumpRateTPerH);
  const delayHours = expectedDelayHours(input);
  const detourHours = (2 * input.offRouteNm) / designSpeedKn;
  const neededHours = bunkering + delayHours + detourHours;
  const overHours = neededHours - slackHours;
  const earliestEtaAtBunker = new Date(now + ((input.alongNm + input.offRouteNm) / designSpeedKn) * H);
  const validUntil = input.offer.validUntil;

  let stoppedBecause: BunkerScreen["stoppedBecause"] = null;
  if (overHours > input.toleranceHours) stoppedBecause = "TIME";
  else if (validUntil && earliestEtaAtBunker.getTime() > new Date(validUntil).getTime()) stoppedBecause = "EXPIRED";

  return {
    passed: stoppedBecause === null,
    stoppedBecause,
    slackHours,
    bunkeringHours: bunkering,
    delayHours,
    detourHours,
    neededHours,
    overHours,
    toleranceHours: input.toleranceHours,
    earliestEtaAtBunker: earliestEtaAtBunker.toISOString(),
    validUntil,
  };
}

/** calculateBunker's input for this plan at the stem quantity; the speed strategy is set by the caller. */
export function bunkerCalcInput(input: BunkerPlanInput): BunkerInput {
  const { qtyT } = stemQty(input.stemQtyT, input.offer.qtyMinT, input.offer.qtyMaxT);
  return {
    remainingNm: input.remainingNm,
    offRouteNm: input.offRouteNm,
    alongNm: input.alongNm,
    speedKn: input.vessel.speedKn,
    designSpeedKn: input.vessel.designSpeedKn,
    minSpeedKn: input.vessel.minSpeedKn,
    fuelTPerDayAtDesign: input.vessel.fuelTPerDayAtDesign,
    auxFuelTPerDay: input.vessel.auxFuelTPerDay,
    now: new Date(input.now),
    deadline: new Date(input.deadline),
    offer: {
      priceUsdPerT: input.offer.priceUsdPerT,
      qtyMinT: input.offer.qtyMinT,
      qtyMaxT: input.offer.qtyMaxT,
      validUntil: input.offer.validUntil ? new Date(input.offer.validUntil) : null,
    },
    refPriceEurPerT: input.refPriceEurPerT,
    usdEurRate: input.usdEurRate,
    portHours: bunkeringHours(qtyT, input.stdQtyT, input.stdPortHours, input.pumpRateTPerH),
    portFeeEur: input.portFeeEur,
    defaultQtyT: input.stdQtyT,
    co2Factor: input.co2Factor,
    qtyT,
    delayHours: expectedDelayHours(input),
    lateToleranceHours: input.toleranceHours,
    // Compare with the best the ship can do without bunkering (slow down and
    // arrive just in time), so slow-steaming savings aren't credited to the offer.
    stayPlan: "JIT",
  };
}

/** The reshaped route for one option: where the ship is when, at what speed. */
export function bunkerWaypoints(calc: BunkerCalc, input: BunkerPlanInput): BunkerWaypoint[] {
  const now = new Date(input.now).getTime();
  const s1 = calc.speedBunkerKn;
  const s2 = calc.speedAfterBunkerKn ?? s1;
  const stop = calc.portHours + (calc.delayHours ?? 0);
  const atTurnOff = now + (input.alongNm / s1) * H;
  const atBunker = new Date(calc.etaAtBunker).getTime();
  const leaveBunker = atBunker + stop * H;
  const atRejoin = leaveBunker + (input.offRouteNm / s2) * H;
  const atDestination = atRejoin + ((input.remainingNm - input.alongNm) / s2) * H;
  const iso = (t: number) => new Date(t).toISOString();
  return [
    { kind: "SHIP", ...input.shipPosition, at: iso(now), speedKn: s1 },
    { kind: "TURN_OFF", ...input.turnOff, at: iso(atTurnOff), speedKn: s1 },
    { kind: "BUNKER_ARRIVE", ...input.bunkerPort, at: iso(atBunker), speedKn: null },
    { kind: "BUNKER_DEPART", ...input.bunkerPort, at: iso(leaveBunker), speedKn: s2 },
    { kind: "REJOIN", ...input.turnOff, at: iso(atRejoin), speedKn: s2 },
    { kind: "DESTINATION", ...input.destination, at: iso(atDestination), speedKn: null },
  ];
}

/**
 * Offer price (USD/t) at which this plan nets exactly zero against our
 * reference price; below it the call pays. Null when no price can fix it
 * (the ship would be late or the offer expired).
 */
export function breakEvenUsdPerT(calc: BunkerCalc): number | null {
  if (!calc.arrivalOk || !calc.offerValidAtArrival || calc.qtyT <= 0) return null;
  const eurPerT = calc.refPriceEurPerT - (calc.extraFuelCostEur + calc.portFeeEur) / calc.qtyT;
  return eurPerT > 0 ? eurPerT / calc.usdEurRate : null;
}

function option(key: BunkerOption["key"], calc: BunkerCalc, input: BunkerPlanInput): BunkerOption {
  return { key, calc, waypoints: bunkerWaypoints(calc, input), breakEvenUsdPerT: breakEvenUsdPerT(calc) };
}

/** Workable and paying options first, then by net €. */
function rank(a: BunkerOption, b: BunkerOption): number {
  const ok = (o: BunkerOption) => (o.calc.verdict === "WORTH_IT" ? 0 : o.calc.arrivalOk && o.calc.offerValidAtArrival ? 1 : 2);
  return ok(a) - ok(b) || b.calc.netEur - a.calc.netEur;
}

/**
 * Screen an offer, then (only if it passes) work out at most two ways to take
 * it: ECO (slowest speed that still makes the berth) and KEEP_SPEED (current
 * speed, arriving early with a buffer), the latter only when it really differs.
 * Pure: the browser re-runs it for what-if changes (e.g. another stem quantity).
 */
export function planBunkerOptions(input: BunkerPlanInput): { screen: BunkerScreen; options: BunkerOption[] } {
  const screen = screenBunkerOffer(input);
  if (!screen.passed) return { screen, options: [] };

  const base = bunkerCalcInput(input);
  const eco = calculateBunker({ ...base, bunkerSpeed: "JIT" });
  const keep = calculateBunker({ ...base, bunkerSpeed: "CATCH_UP" });
  const options = [option("ECO", eco, input)];
  if (keep.speedBunkerKn - eco.speedBunkerKn >= MIN_SPEED_DIFFERENCE_KN) options.push(option("KEEP_SPEED", keep, input));
  return { screen, options: options.sort(rank) };
}

/**
 * Re-price a stored plan at a new reference fuel price or exchange rate.
 * Times, speeds and tonnes stay; € figures, break-even and the order may change.
 */
export function repriceBunkerPlan(plan: BunkerPlan, refPriceEurPerT: number, usdEurRate: number): BunkerPlan {
  const options = plan.options
    .map((o) => {
      const calc = repriceBunker(o.calc, refPriceEurPerT, usdEurRate);
      return { ...o, calc, breakEvenUsdPerT: breakEvenUsdPerT(calc) };
    })
    .sort(rank);
  return { ...plan, input: { ...plan.input, refPriceEurPerT, usdEurRate }, options };
}

/**
 * The single check for an offer the screen stopped: keep speed, catch up if
 * needed. Cheap and with no options, so a person still sees why it fails.
 */
export function screenedOutCalc(input: BunkerPlanInput): BunkerCalc {
  return calculateBunker({ ...bunkerCalcInput(input), stayPlan: "KEEP", bunkerSpeed: "CATCH_UP" });
}
