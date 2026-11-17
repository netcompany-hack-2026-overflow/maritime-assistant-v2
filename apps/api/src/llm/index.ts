import { env } from "../lib/env.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiProvider } from "./openai.js";
import { mockExplainRecommendation, mockExtractEmail, mockAnswerQuestion } from "./mock.js";
import type { LlmProvider } from "./types.js";

export type { CitableRow, LlmProvider, RecommendationFacts } from "./types.js";

class MockProvider implements LlmProvider {
  extractEmail = mockExtractEmail;
  explainRecommendation = mockExplainRecommendation;
  answerQuestion = mockAnswerQuestion;
}

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;

  if (env.llmProvider === "anthropic" && env.anthropicApiKey) {
    cached = new AnthropicProvider(env.anthropicApiKey, env.llmModel);
  } else if (env.llmProvider === "openai" && env.openaiApiKey) {
    cached = new OpenAiProvider(env.openaiApiKey, env.llmModel);
  } else {
    cached = new MockProvider();
  }
  return cached;
}
