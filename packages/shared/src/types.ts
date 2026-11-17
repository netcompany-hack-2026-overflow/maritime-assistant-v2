export type VoyageStatus = "PLANNED" | "UNDERWAY" | "ARRIVED" | "CANCELLED";

export type PortEventType = "BERTH_DELAY" | "CONGESTION" | "CLOSURE" | "NONE";

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
}

export interface RecommendationDTO {
  id: string;
  voyageId: string;
  portEventId: string;
  actionType: "ADJUST_SPEED";
  currentSpeedKn: number;
  recommendedSpeedKn: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  calc: JitCalc;
  rationale: string;
  status: RecommendationStatus;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}
