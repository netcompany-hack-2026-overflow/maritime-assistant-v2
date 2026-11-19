import type { LatLon } from "./geo.js";
export type VoyageStatus = "PLANNED" | "UNDERWAY" | "ARRIVED" | "CANCELLED";

export type PortEventType = "BERTH_DELAY" | "CONGESTION" | "CLOSURE" | "BUNKER_OFFER" | "NONE";

export type RecommendationActionType = "ADJUST_SPEED" | "BUNKER_DETOUR";

export type RecommendationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PortDTO {
  id: string;
  unlocode: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export interface VesselDTO {
  id: string;
  imo: string;
  name: string;
  type: string;
  dwt: number;
  designSpeedKn: number;
  minSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
}

export interface VoyageDTO {
  id: string;
  vesselId: string;
  originPortId: string;
  destPortId: string;
  departedAt: string;
  speedKn: number;
  sailedNmAtRebase: number;
  rebasedAt: string;
  plannedEta: string;
  berthTime: string | null;
  status: VoyageStatus;
  createdAt: string;
}

export interface VesselPositionDTO {
  vesselId: string;
  name: string;
  lat: number;
  lon: number;
  heading: number;
  speedKn: number;
  voyageId: string | null;
  originPort: string | null;
  destPort: string | null;
  etaSim: string | null;
  hasPendingAction: boolean;
  /** Remaining sea route from the ship's position to the destination port. */
  routeAhead: LatLon[];
  /** "ais" when the position is a live AIS fix, "sim" when simulated. */
  source: "ais" | "sim";
  mmsi: string | null;
  /** Time of the AIS fix (null for simulated positions). */
  aisAt: string | null;
}

export interface SeaRouteDTO {
  from: string;
  to: string;
  coords: LatLon[];
  distanceNm: number;
}

export interface SettingsDTO {
  fuelPriceEurPerT: number;
  /** EU Allowance price, € per tonne CO₂. */
  euaPriceEurPerT: number;
  co2Factor: number;
  /** Bunker offers are quoted in USD/t; this converts them to €. */
  usdEurRate: number;
  /** Time alongside the bunker port, h. */
  bunkerPortHours: number;
  /** Port and agency costs of a bunker call, €. */
  bunkerPortFeeEur: number;
  /** Quantity assumed when an offer states none, t. */
  bunkerDefaultQtyT: number;
  /** Barge pumping rate; scales time alongside with the quantity, t/h. */
  bunkerPumpRateTPerH: number;
  /** How far over the ship's slack a bunker call may go before it isn't analysed further, minutes. */
  bunkerSlackToleranceMin: number;
  updatedAt: string;
}

export interface JitCalc {
  distanceNm: number;
  hoursAvailable: number;
  v0: number;
  v1Raw: number;
  v1: number;
  clamped: boolean;
  fuelTPerDayAtDesign: number;
  designSpeedKn: number;
  fAtV0: number;
  fAtV1: number;
  auxFuelTPerDay: number;
  fuelPriceEurPerT: number;
  co2Factor: number;
  waitHoursPlanA: number;
  residualWaitHoursPlanB: number;
  fuelA: number;
  fuelB: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  /** Adverse (positive) or following (negative) current along the route, kn. 0 = no weather. */
  headCurrentKn: number;
  /** Multiplier on daily fuel for added resistance in waves/wind. 1 = calm. */
  seaStateFuelFactor: number;
}

/** Simple weather input for the JIT calculation (mocked in this prototype). */
export interface JitWeather {
  headCurrentKn: number;
  seaStateFuelFactor: number;
}

export interface RecommendationDTO {
  id: string;
  voyageId: string;
  portEventId: string;
  actionType: RecommendationActionType;
  currentSpeedKn: number;
  recommendedSpeedKn: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  calc: JitCalc | BunkerCalc;
  /** Bunker offers only: the screen, the options and the reshaped route. */
  bunkerPlan?: BunkerPlan | null;
  /** The bunker option chosen by sending its acceptance email. */
  chosenOption?: BunkerOptionKey | null;
  rationale: string;
  status: RecommendationStatus;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type BunkerReason = "NEGATIVE_NET" | "LATE" | "EXPIRED";

/** Every step of the bunker-detour calculation, kept for "Show the math". */
export interface BunkerCalc {
  remainingNm: number;
  offRouteNm: number;
  alongNm: number;
  detourNm: number;
  hoursToDeadline: number;
  portHours: number;
  portFeeEur: number;
  v0: number;
  designSpeedKn: number;
  /** Speed needed to still make the berth with the detour; may exceed design speed. */
  requiredSpeedKn: number;
  speedBunkerKn: number;
  sailHoursStay: number;
  waitHoursStay: number;
  sailHoursBunker: number;
  waitHoursBunker: number;
  lateHours: number;
  extraHours: number;
  fuelStayT: number;
  fuelBunkerT: number;
  extraFuelT: number;
  extraCo2T: number;
  co2Factor: number;
  priceUsdPerT: number;
  qtyT: number;
  qtyAssumed: boolean;
  etaAtBunker: string;
  validUntil: string | null;
  offerValidAtArrival: boolean;
  arrivalOk: boolean;
  refPriceEurPerT: number;
  usdEurRate: number;
  offerPriceEurPerT: number;
  priceSavingEur: number;
  extraFuelCostEur: number;
  netEur: number;
  reasons: BunkerReason[];
  verdict: "WORTH_IT" | "NOT_WORTH_IT";

  // Added with bunker options; missing on calcs stored before them.
  stayPlan?: "KEEP" | "JIT";
  bunkerSpeed?: "CATCH_UP" | "JIT";
  /** Speed of the no-bunker plan, kn. */
  speedStayKn?: number;
  /** Speed after leaving the bunker port, kn (equals speedBunkerKn unless the offer's expiry forced a faster leg 1). */
  speedAfterBunkerKn?: number;
  /** Expected wait at the bunker port on top of portHours, h. */
  delayHours?: number;
  /** Lateness at the berth still counted as on time, h. */
  lateToleranceHours?: number;
}

/**
 * ECO: bunker the stem, then sail at the slowest speed that still makes the berth.
 * KEEP_SPEED: bunker the stem at the current speed, arriving early with a buffer for delays.
 */
export type BunkerOptionKey = "ECO" | "KEEP_SPEED";

export interface BunkerWaypoint {
  kind: "SHIP" | "TURN_OFF" | "BUNKER_ARRIVE" | "BUNKER_DEPART" | "REJOIN" | "DESTINATION";
  lat: number;
  lon: number;
  /** ISO time the ship reaches (or, for BUNKER_DEPART, leaves) this point. */
  at: string;
  /** Speed on the leg that starts here, kn; null where the ship stops. */
  speedKn: number | null;
}

export interface BunkerOption {
  key: BunkerOptionKey;
  calc: BunkerCalc;
  /** The reshaped route, point by point, with times for this option's speeds. */
  waypoints: BunkerWaypoint[];
  /** Price (USD/t) at which this option breaks even against our reference price; null if it can't work at any price. */
  breakEvenUsdPerT: number | null;
}

export type BunkerStopReason = "TIME" | "EXPIRED";

/**
 * The cheap check done before any options are worked out. It assumes the
 * fastest case (design speed): if even that doesn't fit in the time the ship
 * has before its berth, plus the tolerance, nothing will, so we stop there.
 */
export interface BunkerScreen {
  passed: boolean;
  stoppedBecause: BunkerStopReason | null;
  /** Time the ship could free up before its berth by sailing at design speed, h. */
  slackHours: number;
  /** Time alongside for the stem quantity, h. */
  bunkeringHours: number;
  /** Expected wait at the bunker port (barge window, congestion), h. */
  delayHours: number;
  /** Detour (out and back) at design speed, h. */
  detourHours: number;
  /** bunkeringHours + delayHours + detourHours. */
  neededHours: number;
  /** neededHours − slackHours; above toleranceHours the analysis stops. */
  overHours: number;
  toleranceHours: number;
  /** Earliest possible arrival at the bunker port (design speed). */
  earliestEtaAtBunker: string;
  validUntil: string | null;
}

export interface BunkerDelaySource {
  source: "SUPPLIER_WINDOW" | "PORT_CONGESTION" | "PORT_CLOSURE";
  hours: number;
  /** Plain words for the UI, e.g. "barge alongside ETA+12 h (supplier)". */
  note: string;
}

/**
 * Everything planBunkerOptions needs, as plain JSON (dates as ISO strings),
 * stored with the plan so the browser can re-run it for what-if changes.
 */
export interface BunkerPlanInput {
  now: string;
  /** Berth time, or planned ETA when no berth time is set. */
  deadline: string;
  remainingNm: number;
  offRouteNm: number;
  alongNm: number;
  shipPosition: LatLon;
  turnOff: LatLon;
  bunkerPort: LatLon;
  destination: LatLon;
  vessel: {
    speedKn: number;
    designSpeedKn: number;
    minSpeedKn: number;
    fuelTPerDayAtDesign: number;
    auxFuelTPerDay: number;
  };
  offer: { priceUsdPerT: number; qtyMinT: number | null; qtyMaxT: number | null; validUntil: string | null };
  /** Quantity the ship wants; clamped to what the supplier offers, t. */
  stemQtyT: number;
  refPriceEurPerT: number;
  usdEurRate: number;
  /** Time alongside for the standard stem (Settings.bunkerPortHours / bunkerDefaultQtyT). */
  stdPortHours: number;
  stdQtyT: number;
  pumpRateTPerH: number;
  portFeeEur: number;
  co2Factor: number;
  delays: BunkerDelaySource[];
  toleranceHours: number;
  /** Share of the voyage's CO₂ under the EU ETS (1 / 0.5 / 0, see etsVoyageScope); missing = 1. */
  etsScope?: number;
}

/** Everything the reply-email templates need, frozen when the offer is processed. */
export interface BunkerDraftContext {
  supplierName: string | null;
  supplierAddr: string;
  offerSubject: string;
  vesselName: string;
  vesselImo: string;
  portName: string;
  portUnlocode: string;
  fuelGrade: string | null;
  priceUsdPerT: number;
  validUntil: string | null;
  senderName: string;
}

export interface BunkerPlan {
  version: 1;
  input: BunkerPlanInput;
  screen: BunkerScreen;
  /** Best first. Empty when the screen stopped the analysis. */
  options: BunkerOption[];
  /** The remaining route split at the turn-off point; the detour is turnOff → bunkerPort → turnOff. */
  route: { before: LatLon[]; after: LatLon[] };
  context: BunkerDraftContext;
}

export type BargingType = "INCLUDED" | "LUMP_SUM" | "PER_MT";

/** One fuel grade in an offer; a single email can quote several. */
export interface OfferLine {
  fuelGrade: string;
  priceUsdPerT: number;
  qtyMinT: number | null;
  qtyMaxT: number | null;
}

/** Commercial terms of a bunker offer beyond grade/price/quantity (PortEvent.offerTerms). */
export interface OfferTerms {
  vesselImo: string | null;
  /** Vessel ETA as the supplier states it (ISO), if any. */
  vesselEta: string | null;
  /** null = not stated (treated as included, and flagged). */
  bargingType: BargingType | null;
  /** USD lump sum, or USD per tonne for PER_MT. */
  bargingUsd: number | null;
  /** Overtime, agency fees etc. stated in the offer, USD. */
  otherFeesUsd: number | null;
  paymentTerms: string | null;
  /** Days of credit; 0 = cash in advance; null = not stated. */
  paymentDays: number | null;
  /** Barge alongside this many hours after the ship arrives; 0 = prompt. */
  deliveryDelayHours: number | null;
  /** Earliest delivery as an absolute time (ISO), if stated that way. */
  deliveryEarliest: string | null;
  /** How long the price is firm, minutes. */
  quoteValidityMinutes: number | null;
  /** receivedAt + quoteValidityMinutes: accept before this or re-quote. */
  quoteFirmUntil: string | null;
  lines: OfferLine[];
}

export type EmailDraftKind = "ACCEPT" | "COUNTER" | "DECLINE";
export type EmailDraftStatus = "DRAFT" | "SENT" | "SUPERSEDED";

/** A reply the agent has written for a person to read, edit and send. */
export interface EmailDraftSpec {
  kind: EmailDraftKind;
  /** The bunker option an ACCEPT or COUNTER is for. */
  optionKey: BunkerOptionKey | null;
  toAddr: string;
  subject: string;
  body: string;
}

export interface EmailDraftDTO {
  id: string;
  recommendationId: string;
  kind: EmailDraftKind;
  optionKey: BunkerOptionKey | null;
  toAddr: string;
  subject: string;
  body: string;
  status: EmailDraftStatus;
  edited: boolean;
  sentAt: string | null;
  messageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One supplier offer with everything the Bunkering page needs to compare and answer it. */
export interface BunkerOfferDTO {
  recommendationId: string;
  status: RecommendationStatus;
  chosenOption: BunkerOptionKey | null;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  rationale: string;
  voyage: {
    id: string;
    status: VoyageStatus;
    vesselName: string;
    vesselImo: string;
    originPortName: string;
    destPortName: string;
    charterRateUsdPerDay: number;
  };
  email: { id: string; fromAddr: string; subject: string; receivedAt: string };
  port: { name: string; unlocode: string };
  supplier: { name: string; reliabilityScore: number; known: boolean };
  fuelGrade: string | null;
  priceUsdPerT: number;
  qtyMinT: number | null;
  qtyMaxT: number | null;
  validUntil: string | null;
  terms: OfferTerms;
  /** Null for offers processed before bunker options existed. */
  plan: BunkerPlan | null;
  calc: BunkerCalc;
  drafts: EmailDraftDTO[];
}

export interface EmailProviderStatus {
  configured: boolean;
  from: string | null;
  redirectTo: string | null;
  missing: string[];
}

/** Start of the reason given to options closed because another option for the same ship was approved. */
export const NOT_TAKEN_PREFIX = "Δεν επιλέχθηκε: ";
