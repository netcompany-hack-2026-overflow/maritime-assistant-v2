import Anthropic from "@anthropic-ai/sdk";
import { answerSchema, type Answer, type PortEventExtraction } from "@maritime/shared";
import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction.js";
import type { CitableRow, LlmProvider, RecommendationFacts } from "./types.js";

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string, timeoutMs = 30_000) {
    // One SDK-level retry on network/5xx errors; the JSON loop below adds at most one more call.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    this.model = model;
  }

  private async completeJson(system: string, userMessage: string): Promise<unknown> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system,
        messages,
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      try {
        return JSON.parse(stripCodeFence(text));
      } catch {
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: "That was not valid JSON. Reply again with ONLY the JSON object, no other text.",
        });
      }
    }
    throw new Error("LLM extraction failed: provider did not return valid JSON after retry.");
  }

  async extractEmail(text: string): Promise<PortEventExtraction> {
    const raw = await this.completeJson(EXTRACTION_SYSTEM_PROMPT, text);
    return parseExtraction(raw);
  }

  async explainRecommendation(facts: RecommendationFacts): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system:
        "You write a 2-3 sentence plain-English rationale for a ship operations recommendation " +
        "(a speed adjustment, or, when a bunker block is present, whether a bunker detour is worth it), " +
        "given the facts and numbers already computed. Never invent numbers; " +
        "only restate the ones given.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  async answerQuestion(question: string, rows: CitableRow[]): Promise<Answer> {
    const system =
      "You answer questions about a maritime fleet using ONLY the rows provided. " +
      'Reply with ONLY a JSON object: {"answer":string,"citations":[{"table":string,"id":string}]}. ' +
      "Every citation must reference a table+id pair that appears in the provided rows. " +
      "If you cannot answer from the rows, reply with answer \"I can't answer that from the data.\" and citations: [].";

    const raw = await this.completeJson(
      system,
      `Question: ${question}\n\nRows:\n${JSON.stringify(rows)}`
    );
    return answerSchema.parse(raw);
  }
}
