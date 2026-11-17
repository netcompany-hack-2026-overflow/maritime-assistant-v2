import Anthropic from "@anthropic-ai/sdk";
import { answerSchema, portEventExtractionSchema, type Answer, type PortEventExtraction } from "@maritime/shared";
import type { CitableRow, LlmProvider, RecommendationFacts } from "./types.js";

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
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
    const system =
      "You extract structured port-event data from maritime port-agent emails. " +
      "Reply with ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape: " +
      '{"eventType":"BERTH_DELAY"|"CONGESTION"|"CLOSURE"|"NONE","portName":string|null,' +
      '"portUnlocode":string|null,"vesselNameMentioned":string|null,"delayHours":number|null,' +
      '"newBerthTime":string|null (ISO 8601),"confidence":number (0-1),' +
      '"sourceSpans":[{"field":string,"text":string}]}. ' +
      "Each sourceSpans[].text must be an exact substring copied from the email. " +
      'If the email describes no port event affecting a vessel, use eventType "NONE" and null fields.';

    const raw = await this.completeJson(system, text);
    return portEventExtractionSchema.parse(raw);
  }

  async explainRecommendation(facts: RecommendationFacts): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system:
        "You write a 2-3 sentence plain-English rationale for a ship speed-adjustment " +
        "recommendation, given the facts and numbers already computed. Never invent numbers; " +
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
