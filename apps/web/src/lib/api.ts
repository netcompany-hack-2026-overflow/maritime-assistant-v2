import type {
  BunkerOfferDTO,
  BunkerPlan,
  EmailDraftDTO,
  EmailProviderStatus,
  TcoAssumptions,
  TcoExplanation,
  CharterPartyDTO,
  CharterPartyTerms,
  PortDTO,
  ScenarioId,
  ScenarioSet,
  PortEventType,
  RecommendationStatus,
  SeaRouteDTO,
  SettingsDTO,
  VesselPositionDTO,
  VoyageInsuranceDTO,
  VoyageInsuranceSummary,
  VoyageStatus,
  WarRiskAssessment,
} from "@maritime/shared";

export interface AisStatus {
  enabled: boolean;
  connected: boolean;
  trackedMmsi: string[];
  messagesReceived: number;
  lastMessageAt: string | null;
  lastError: string | null;
}

export interface MetaResponse {
  llmProvider: "mock" | "anthropic" | "openai";
  simSpeed: number;
  fuelPriceEurPerT: number;
  euaPriceEurPerT: number;
  co2Factor: number;
  /** Outgoing email (SMTP) status; older APIs leave it out. */
  emailProvider?: EmailProviderStatus;
  weatherProvider: "open-meteo" | "mock";
  weatherError: string | null;
  ais: AisStatus;
}

export interface OutboundEmail {
  id: string;
  recommendationId: string;
  toAddrs: string;
  ccAddrs: string;
  subject: string;
  body: string;
  status: "DRAFT" | "SENT" | "WITHDRAWN";
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharterPartySaveResult {
  charterParty: CharterPartyDTO;
  recomputedRecommendations: number;
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
  ytdCo2T: number | null;
  ytdDistanceNm: number | null;
  mmsi: string | null;
  aisAt: string | null;
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
  charterParty: { id: string; sourceName: string } | null;
  /** War-risk insurance at a glance (listed areas, additional premium, notice). */
  insurance?: VoyageInsuranceSummary;
  status: VoyageStatus;
  ciiAttained?: number | null;
  ciiRating?: "A" | "B" | "C" | "D" | "E" | null;
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

export interface VoyageWithRelations extends Omit<VoyageListItem, "charterParty"> {
  vessel?: { id: string; name: string; imo: string; type: string; dwt: number };
  originPort?: { id: string; name: string; country: string };
  destPort?: { id: string; name: string; country: string };
  charterParty?: {
    id: string;
    sourceName: string;
    terms: CharterPartyTerms;
    expectedOpsHours: number | null;
  } | null;
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
  actionType: "ADJUST_SPEED" | "BUNKER_DETOUR";
  currentSpeedKn: number;
  recommendedSpeedKn: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  etsSavedEur: number;
  demurrageAvoided: number | null;
  calc: Record<string, number | boolean>;
  bunkerPlan?: BunkerPlan | null;
  chosenOption?: string | null;
  emailDrafts?: EmailDraftDTO[];
  scenarios: ScenarioSet | null;
  chosenScenario: ScenarioId | null;
  rationale: string;
  status: RecommendationStatus;
  rejectReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  voyage?: VoyageWithRelations;
  portEvent?: PortEventRecord;
  outboundEmails?: OutboundEmail[];
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
  updateSettings: (input: { fuelPriceEurPerT?: number; euaPriceEurPerT?: number }) =>
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
  previewVoyageInsurance: (input: CreateVoyageInput) =>
    request<WarRiskAssessment>("/voyages/insurance-preview", { method: "POST", body: JSON.stringify(input) }),
  getVoyageInsurance: (voyageId: string) => request<VoyageInsuranceDTO>(`/voyages/${voyageId}/insurance`),
  regenerateInsuranceAnalysis: (voyageId: string) =>
    request<VoyageInsuranceDTO>(`/voyages/${voyageId}/insurance/analysis`, { method: "POST" }),
  setInsuranceQuote: (voyageId: string, zoneId: string, pct: number | null) =>
    request<VoyageInsuranceDTO>(`/voyages/${voyageId}/insurance/quotes`, {
      method: "PUT",
      body: JSON.stringify({ zoneId, pct }),
    }),
  saveInsuranceNotice: (voyageId: string, input: { to: string; subject: string; body: string }) =>
    request<VoyageInsuranceDTO>(`/voyages/${voyageId}/insurance/notice`, { method: "PUT", body: JSON.stringify(input) }),
  sendInsuranceNotice: (voyageId: string) =>
    request<VoyageInsuranceDTO>(`/voyages/${voyageId}/insurance/notice/send`, { method: "POST" }),
  getEmails: () => request<EmailListItem[]>("/emails"),
  simulateEmail: () => request<EmailListItem>("/emails/simulate", { method: "POST" }),
  createEmail: (input: { fromAddr: string; subject: string; body: string }) =>
    request<EmailListItem>("/emails", { method: "POST", body: JSON.stringify(input) }),
  deleteEmail: (id: string) => request<void>(`/emails/${id}`, { method: "DELETE" }),
  resetDemo: () =>
    request<{ voyages: number; queuedEmails: number }>("/demo/reset", {
      method: "POST",
      body: JSON.stringify({ confirm: "RESET" }),
    }),
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
  approveRecommendation: (id: string, scenarioId?: ScenarioId) =>
    request<{ voyage: VoyageWithRelations; notice: OutboundEmail | null }>(`/recommendations/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(scenarioId ? { scenarioId } : {}),
    }),
  refreshRecommendation: (id: string) =>
    request<RecommendationRecord>(`/recommendations/${id}/refresh`, { method: "POST" }),
  updateOutboundEmail: (id: string, input: Partial<Pick<OutboundEmail, "toAddrs" | "ccAddrs" | "subject" | "body">>) =>
    request<OutboundEmail>(`/outbound-emails/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  markOutboundEmailSent: (id: string) =>
    request<OutboundEmail>(`/outbound-emails/${id}/sent`, { method: "POST" }),
  sendOutboundEmail: (id: string) =>
    request<OutboundEmail>(`/outbound-emails/${id}/send`, { method: "POST" }),
  getCharterParty: async (voyageId: string): Promise<CharterPartyDTO | null> => {
    const res = await fetch(`/api/voyages/${voyageId}/charter-party`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load the charter party (${res.status})`);
    return res.json() as Promise<CharterPartyDTO>;
  },
  saveCharterPartyText: (voyageId: string, text: string, sourceName?: string) =>
    request<CharterPartySaveResult>(`/voyages/${voyageId}/charter-party`, {
      method: "POST",
      body: JSON.stringify({ text, sourceName }),
    }),
  uploadCharterParty: async (voyageId: string, file: File): Promise<CharterPartySaveResult> => {
    const res = await fetch(
      `/api/voyages/${voyageId}/charter-party/document?filename=${encodeURIComponent(file.name)}`,
      { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Upload failed with ${res.status}`);
    }
    return res.json() as Promise<CharterPartySaveResult>;
  },
  updateCharterParty: (voyageId: string, input: { terms?: CharterPartyTerms; expectedOpsHours?: number | null }) =>
    request<CharterPartySaveResult>(`/voyages/${voyageId}/charter-party`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCharterParty: (voyageId: string) =>
    request<void>(`/voyages/${voyageId}/charter-party`, { method: "DELETE" }),
  linkAis: (vesselId: string, mmsi: string | null) =>
    request<{ id: string; mmsi: string | null; ais: AisStatus }>(`/vessels/${vesselId}/ais`, {
      method: "PUT",
      body: JSON.stringify({ mmsi }),
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
  getBunkerOffers: () => request<BunkerOfferDTO[]>("/bunker-offers"),
  simulateBunkerQuotes: () =>
    request<Array<{ demoId: string; emailId: string; recommendationId: string | null; matchedVoyageId: string | null }>>(
      "/bunker-offers/simulate",
      { method: "POST" }
    ),
  explainBunkerOffers: (voyageId: string, assumptions: TcoAssumptions) =>
    request<{ text: string; draft: TcoExplanation }>("/bunker-offers/explain", {
      method: "POST",
      body: JSON.stringify({ voyageId, ...assumptions }),
    }),
  updateEmailDraft: (id: string, edit: { toAddr?: string; subject?: string; body?: string }) =>
    request<EmailDraftDTO>(`/email-drafts/${id}`, { method: "PATCH", body: JSON.stringify(edit) }),
  sendEmailDraft: (id: string) =>
    request<{ draft: EmailDraftDTO; deliveredTo: string }>(`/email-drafts/${id}/send`, { method: "POST" }),
  askQuestion: (question: string) =>
    request<AskResponse>("/ask", { method: "POST", body: JSON.stringify({ question }) }),
};
