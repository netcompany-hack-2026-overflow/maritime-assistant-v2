import type { Answer, PortEventExtraction } from "@maritime/shared";

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
}
