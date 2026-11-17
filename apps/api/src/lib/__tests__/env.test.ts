import { describe, expect, it } from "vitest";
import { env } from "../env.js";

describe("env", () => {
  it("defaults the LLM provider to mock so the app works with no API key", () => {
    expect(env.llmProvider).toBe("mock");
  });

  it("defaults the API port to 4000", () => {
    expect(env.port).toBe(4000);
  });
});
