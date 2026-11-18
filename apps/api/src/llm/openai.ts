import OpenAI from "openai";
import { answerSchema, type Answer, type PortEventExtraction } from "@maritime/shared";
import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction.js";
import type { CitableRow, LlmProvider, RecommendationFacts } from "./types.js";
import { mockExplainRecommendation } from "./mock.js";

const MAX_JSON_TOKENS = 4000;
const MAX_TEXT_TOKENS = 2000;

export class OpenAiProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, timeoutMs = 30_000) {
    // One SDK-level retry on network/5xx errors; the JSON loop below adds at most one more call.
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
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
        // Caps total output. GPT-5-family reasoning tokens count toward it, so
        // leave headroom beyond the ~300 visible tokens a reply actually needs.
        max_completion_tokens: MAX_JSON_TOKENS,
        messages,
      });
      const choice = response.choices[0];
      const text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length" && text.trim() === "") {
        throw new Error("LLM hit its output-token limit before answering.");
      }
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
    const raw = await this.completeJson(EXTRACTION_SYSTEM_PROMPT, text);
    return parseExtraction(raw);
  }

  async explainRecommendation(facts: RecommendationFacts): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: MAX_TEXT_TOKENS,
      messages: [
        {
          role: "system",
          content:
            "You write a 2-3 sentence plain-English rationale for a ship operations recommendation " +
            "(a speed adjustment, or, when a bunker block is present, whether a bunker detour is worth it), " +
            "given the facts and numbers already computed. Never invent numbers; " +
            "only restate the ones given.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
    const text = (response.choices[0]?.message?.content ?? "").trim();
    // Never show an empty rationale (e.g. the token cap was spent on reasoning):
    // fall back to the deterministic template built from the same numbers.
    return text.length > 0 ? text : mockExplainRecommendation(facts);
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
