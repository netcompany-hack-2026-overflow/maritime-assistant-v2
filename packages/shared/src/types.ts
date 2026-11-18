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
}

export interface SeaRouteDTO {
  from: string;
  to: string;
  coords: LatLon[];
  distanceNm: number;
}

export interface SettingsDTO {
  fuelPriceEurPerT: number;
  co2Factor: number;
  /** Bunker offers are quoted in USD/t; this converts them to €. */
  usdEurRate: number;
  /** Time alongside the bunker port, h. */
  bunkerPortHours: number;
  /** Port and agency costs of a bunker call, €. */
  bunkerPortFeeEur: number;
  /** Quantity assumed when an offer states none, t. */
  bunkerDefaultQtyT: number;
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
}
