import type { Answer, CharterPartyTerms, PortEventExtraction } from "@maritime/shared";

export interface RecommendationFacts {
  vesselName: string;
  originPortName: string;
  destPortName: string;
  portEventType: string;
  portName: string;
  delayHours: number;
  currentSpeedKn: number;
  recommendedSpeedKn: number;
  fuelSavedT: number;
  costSavedEur: number;
  co2SavedT: number;
  /** Present for a bunker-detour recommendation; the speed fields then describe the catch-up speed. */
  bunker?: BunkerFacts;
  /** e.g. "B — Just-in-time" */
  scenarioLabel?: string;
  scenarioDescription?: string;
  etsSavedEur?: number;
  /** Demurrage avoided vs baseline, in `currency`; null without a charter party. */
  demurrageAvoided?: number | null;
  currency?: string | null;
  jitNote?: string;
  weather?: string;
}

export interface BunkerFacts {
  bunkerPortName: string;
  fuelGrade: string | null;
  priceUsdPerT: number;
  qtyT: number;
  detourNm: number;
  extraHours: number;
  extraFuelT: number;
  priceSavingEur: number;
  netEur: number;
  stillMakesBerth: boolean;
  offerValidAtArrival: boolean;
  verdict: "WORTH_IT" | "NOT_WORTH_IT";
}

/** Everything the notice to charterers/agent may state. Numbers are pre-computed. */
export interface NoticeFacts {
  vesselName: string;
  imo: string;
  originPortName: string;
  destPortName: string;
  portEventType: string;
  delayHours: number | null;
  /** Who reported the event (the agent's notice). */
  reportedBy: string | null;
  previousEtaUtc: string;
  newEtaUtc: string;
  berthTimeUtc: string;
  scenarioLabel: string;
  scenarioDescription: string;
  newSpeedKn: number;
  previousSpeedKn: number;
  fuelSavedT: number;
  co2SavedT: number;
  weather: string;
  cp: null | {
    reference: string | null;
    chartererName: string | null;
    laytimeHours: number | null;
    laytimeBasis: string | null;
    norNoticeHours: number | null;
    waitingTimeCounts: boolean | null;
    demurrageRatePerDay: number | null;
    currency: string | null;
    jitClauseName: string | null;
    jitCoverage: string;
    /** JitCoverageStatus: COVERED | NEEDS_INSTRUCTION | NOT_COVERED | NOT_APPLICABLE */
    jitStatus: string;
    laytimeUsedHours: number | null;
    withinLaytime: boolean | null;
    demurrageAvoided: number | null;
  };
}

export interface NoticeDraft {
  subject: string;
  body: string;
}

export interface CitableRow {
  table: string;
  id: string;
  data: Record<string, unknown>;
}

/** The computed comparison of a ship's bunker offers, for a plain-English recommendation. */
export interface BunkerComparisonFacts {
  vesselName: string;
  assumptions: Record<string, unknown>;
  offers: Array<Record<string, unknown>>;
  /** The deterministic explanation; the model may only reword it. */
  draft: { headline: string; reasons: string[]; warnings: string[] };
}

export interface LlmProvider {
  extractEmail(text: string): Promise<PortEventExtraction>;
  explainRecommendation(facts: RecommendationFacts): Promise<string>;
  /** Optional second opinion on a comparison, only when a person asks for it. */
  explainBunkerComparison(facts: BunkerComparisonFacts): Promise<string>;
  answerQuestion(question: string, rows: CitableRow[]): Promise<Answer>;
  extractCharterParty(text: string): Promise<CharterPartyTerms>;
  draftNotice(facts: NoticeFacts): Promise<NoticeDraft>;
}
