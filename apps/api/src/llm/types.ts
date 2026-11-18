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

export interface LlmProvider {
  extractEmail(text: string): Promise<PortEventExtraction>;
  explainRecommendation(facts: RecommendationFacts): Promise<string>;
  answerQuestion(question: string, rows: CitableRow[]): Promise<Answer>;
}
