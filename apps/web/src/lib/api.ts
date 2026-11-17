import type {
  PortDTO,
  PortEventType,
  RecommendationStatus,
  SeaRouteDTO,
  SettingsDTO,
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
  routeNm: number | null;
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
  voyage?: VoyageWithRelations;
  portEvent?: PortEventRecord;
}

export interface RecordResponse {
  table: string;
  id: string;
  data: Record<string, unknown>;
}

export interface Citation {
  table: string;
  id: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export interface CreateVoyageInput {
  vesselId: string;
  originPortId: string;
  destPortId: string;
  speedKn?: number;
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
  getSeaRoute: (fromUnlocode: string, toUnlocode: string) =>
    request<SeaRouteDTO>(
      `/ports/route?from=${encodeURIComponent(fromUnlocode)}&to=${encodeURIComponent(toUnlocode)}`
    ),
  getSettings: () => request<SettingsDTO>("/settings"),
  updateSettings: (input: { fuelPriceEurPerT: number }) =>
    request<{ settings: SettingsDTO; repricedRecommendations: number }>("/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  getVessels: () => request<VesselListItem[]>("/vessels"),
  getVesselPositions: () => request<VesselPositionDTO[]>("/vessels/positions"),
  getVoyages: () => request<VoyageListItem[]>("/voyages"),
  createVoyage: (input: CreateVoyageInput) =>
    request<VoyageListItem>("/voyages", { method: "POST", body: JSON.stringify(input) }),
  cancelVoyage: (id: string) =>
    request<VoyageListItem>(`/voyages/${id}/cancel`, { method: "PATCH" }),
  getEmails: () => request<EmailListItem[]>("/emails"),
  simulateEmail: () => request<EmailListItem>("/emails/simulate", { method: "POST" }),
  createEmail: (input: { fromAddr: string; subject: string; body: string }) =>
    request<EmailListItem>("/emails", { method: "POST", body: JSON.stringify(input) }),
  uploadDocument: async (file: File): Promise<EmailListItem> => {
    const res = await fetch(`/api/emails/document?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Upload failed with ${res.status}`);
    }
    return res.json() as Promise<EmailListItem>;
  },
  processEmail: (id: string) =>
    request<ProcessEmailResult>(`/emails/${id}/process`, { method: "POST" }),
  getPortEvents: () => request<PortEventRecord[]>("/port-events"),
  getRecommendations: (status?: RecommendationStatus) =>
    request<RecommendationRecord[]>(`/recommendations${status ? `?status=${status}` : ""}`),
  approveRecommendation: (id: string) =>
    request<{ voyage: VoyageWithRelations }>(`/recommendations/${id}/approve`, {
      method: "POST",
    }),
  undoApproval: (id: string) =>
    request<{ voyage: VoyageWithRelations; recommendation: RecommendationRecord }>(
      `/recommendations/${id}/undo`,
      { method: "POST" }
    ),
  rejectRecommendation: (id: string, reason: string) =>
    request<RecommendationRecord>(`/recommendations/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  getRecord: (table: string, id: string) => request<RecordResponse>(`/records/${table}/${id}`),
  askQuestion: (question: string) =>
    request<AskResponse>("/ask", { method: "POST", body: JSON.stringify({ question }) }),
};
