import OpenAI from "openai";
import { answerSchema, portEventExtractionSchema, type Answer, type PortEventExtraction } from "@maritime/shared";
import type { CitableRow, LlmProvider, RecommendationFacts } from "./types.js";

export class OpenAiProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  private async completeJson(
    system: string,
    userMessage: string
  ): Promise<unknown> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages,
      });
      const text = response.choices[0]?.message?.content ?? "";
      try {
        return JSON.parse(text);
      } catch {
        messages.push({ role: "assistant", content: text });
        messages.push({
          role: "user",
          content: "That was not valid JSON. Reply again with ONLY the JSON object.",
        });
      }
    }
    throw new Error("LLM extraction failed: provider did not return valid JSON after retry.");
  }

  async extractEmail(text: string): Promise<PortEventExtraction> {
    const system =
      "You extract structured port-event data from maritime port-agent emails. " +
      "Reply with ONLY a JSON object matching exactly this shape: " +
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
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You write a 2-3 sentence plain-English rationale for a ship speed-adjustment " +
            "recommendation, given the facts and numbers already computed. Never invent numbers; " +
            "only restate the ones given.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
    return (response.choices[0]?.message?.content ?? "").trim();
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
