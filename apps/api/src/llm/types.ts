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
