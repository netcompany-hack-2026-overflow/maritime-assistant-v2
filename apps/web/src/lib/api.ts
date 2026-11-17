import type {
  PortDTO,
  PortEventType,
  RecommendationStatus,
  VesselPositionDTO,
  VoyageStatus,
} from "@maritime/shared";

export interface MetaResponse {
  llmProvider: "mock" | "anthropic" | "openai";
  simSpeed: number;
  fuelPriceEurPerT: number;
  co2Factor: number;
}

export interface VesselListItem {
  id: string;
  imo: string;
  name: string;
  type: string;
  dwt: number;
  designSpeedKn: number;
  minSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  status: VoyageStatus | "IDLE";
  speedKn: number | null;
  destPort: string | null;
  originPort: string | null;
  voyageId: string | null;
}

export interface VoyageListItem {
  id: string;
  vesselId: string;
  vesselName: string;
  vesselImo: string;
  vesselType: string;
  originPortId: string;
  originPortName: string;
  destPortId: string;
  destPortName: string;
  departedAt: string;
  speedKn: number;
  sailedNmAtRebase: number;
  rebasedAt: string;
  plannedEta: string;
  berthTime: string | null;
  status: VoyageStatus;
  createdAt: string;
}

export interface EmailListItem {
  id: string;
  fromAddr: string;
  subject: string;
  body: string;
  receivedAt: string;
  processed: boolean;
  queued: boolean;
  createdAt: string;
}

export interface SourceSpan {
  field: string;
  text: string;
}

export interface VoyageWithRelations extends VoyageListItem {
  vessel?: { id: string; name: string; imo: string };
  originPort?: { id: string; name: string };
  destPort?: { id: string; name: string };
}

export interface PortEventRecord {
  id: string;
  emailId: string;
  portId: string | null;
  voyageId: string | null;
  eventType: PortEventType;
  delayHours: number | null;
  newBerthTime: string | null;
  rawExtraction: unknown;
  sourceSpans: SourceSpan[];
  confidence: number;
  createdAt: string;
  email?: EmailListItem;
  port?: { id: string; name: string; unlocode: string } | null;
  voyage?: VoyageWithRelations | null;
}

export interface RecommendationRecord {
  id: string;
  voyageId: string;
  portEventId: string;
  actionType: "ADJUST_SPEED";
  currentSpeedKn: number;
  recommendedSpeedKn: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  calc: Record<string, number | boolean>;
  rationale: string;
  status: RecommendationStatus;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ProcessEmailResult {
  portEvent: PortEventRecord | null;
  matchedVoyage: VoyageWithRelations | null;
  recommendation: RecommendationRecord | null;
  alreadyProcessed: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMeta: () => request<MetaResponse>("/meta"),
  getPorts: () => request<PortDTO[]>("/ports"),
  getVessels: () => request<VesselListItem[]>("/vessels"),
  getVesselPositions: () => request<VesselPositionDTO[]>("/vessels/positions"),
  getVoyages: () => request<VoyageListItem[]>("/voyages"),
  getEmails: () => request<EmailListItem[]>("/emails"),
  simulateEmail: () => request<EmailListItem>("/emails/simulate", { method: "POST" }),
  createEmail: (input: { fromAddr: string; subject: string; body: string }) =>
    request<EmailListItem>("/emails", { method: "POST", body: JSON.stringify(input) }),
  processEmail: (id: string) =>
    request<ProcessEmailResult>(`/emails/${id}/process`, { method: "POST" }),
  getPortEvents: () => request<PortEventRecord[]>("/port-events"),
};
