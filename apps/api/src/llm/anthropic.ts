import Anthropic from "@anthropic-ai/sdk";
import { answerSchema, type Answer, type CharterPartyTerms, type PortEventExtraction } from "@maritime/shared";
import {
  CHARTER_PARTY_SYSTEM_PROMPT,
  NOTICE_SYSTEM_PROMPT,
  mockDraftNotice,
  noticeDraftSchema,
  parseCharterPartyTerms,
} from "./charterParty.js";

import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction.js";
import type {
  BunkerComparisonFacts,
  CitableRow,
  LlmProvider,
  NoticeDraft,
  NoticeFacts,
  RecommendationFacts,
} from "./types.js";
import { mockExplainBunkerComparison } from "./mock.js";

export const BUNKER_COMPARISON_SYSTEM =
  "You advise a ship operator choosing between bunker (fuel) offers. Using ONLY the numbers in the JSON, " +
  "write at most 4 short sentences of plain Greek (keep vessel, port, supplier names and terms like ETA, EU ETS, barging in English): which offer to take, why it beats the others (name the " +
  "cheapest-on-paper offer if it is not the best), and anything urgent (an expiring quote, an offer that " +
  "doesn't fit the schedule). Never invent or recalculate numbers; reuse the ones given, rounded as given. " +
  "The 'draft' field is a correct explanation you may reword.";

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
        max_tokens: 2048,
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
        "You write a 2-3 sentence rationale in plain Greek (keep vessel and port names, kn, ETA, EU ETS in English) for a ship operations recommendation " +
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

  async explainBunkerComparison(facts: BunkerComparisonFacts): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system: BUNKER_COMPARISON_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return text.length > 0 ? text : mockExplainBunkerComparison(facts);
  }

  async answerQuestion(question: string, rows: CitableRow[]): Promise<Answer> {
    const system =
      "You answer questions about a maritime fleet using ONLY the rows provided. " +
      'Reply with ONLY a JSON object: {"answer":string,"citations":[{"table":string,"id":string}]}. ' +
      "Every citation must reference a table+id pair that appears in the provided rows. " +
      "Write the answer in Greek. If you cannot answer from the rows, reply with answer \"Δεν μπορώ να απαντήσω από τα δεδομένα.\" and citations: [].";

    const raw = await this.completeJson(
      system,
      `Question: ${question}\n\nRows:\n${JSON.stringify(rows)}`
    );
    return answerSchema.parse(raw);
  }

  async extractCharterParty(text: string): Promise<CharterPartyTerms> {
    const raw = await this.completeJson(CHARTER_PARTY_SYSTEM_PROMPT, text.slice(0, 60_000));
    return parseCharterPartyTerms(raw);
  }

  async draftNotice(facts: NoticeFacts): Promise<NoticeDraft> {
    try {
      const raw = await this.completeJson(NOTICE_SYSTEM_PROMPT, JSON.stringify(facts));
      return noticeDraftSchema.parse(raw);
    } catch (err) {
      // An approval must never fail because the email draft did: use the template.
      console.warn(`Notice draft via LLM failed, using template: ${(err as Error).message}`);
      return mockDraftNotice(facts);
    }
  }
}
