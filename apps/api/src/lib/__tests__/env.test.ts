import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, env, resolveLlmModel } from "../env.js";

describe("env", () => {
  it("defaults the LLM provider to mock so the app works with no API key", () => {
    expect(env.llmProvider).toBe("mock");
  });

  it("defaults the API port to 4000", () => {
    expect(env.port).toBe(4000);
  });
});

describe("resolveLlmModel", () => {
  it("uses an OpenAI model name when the provider is openai and LLM_MODEL is unset or empty", () => {
    expect(resolveLlmModel("openai", undefined)).toBe(DEFAULT_MODELS.openai);
    expect(resolveLlmModel("openai", "")).toBe(DEFAULT_MODELS.openai);
  });

  it("uses a Claude model name when the provider is anthropic and LLM_MODEL is unset", () => {
    expect(resolveLlmModel("anthropic", undefined)).toBe(DEFAULT_MODELS.anthropic);
  });

  it("respects an explicit LLM_MODEL override", () => {
    expect(resolveLlmModel("openai", "gpt-custom")).toBe("gpt-custom");
  });
});
