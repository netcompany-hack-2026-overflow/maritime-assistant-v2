import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local dev (npm run dev) runs from apps/api, so nothing would pick up the repo-root
// .env the README tells you to create. Load it here; real environment variables
// (docker compose, CI) always win because loadEnvFile never overrides them.
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env");
if (!process.env.VITEST && existsSync(rootEnv) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(rootEnv);
}

type LlmProviderName = "mock" | "anthropic" | "openai";

/** Model used when LLM_MODEL is unset or empty, so each provider gets a model name it understands. */
export const DEFAULT_MODELS: Record<Exclude<LlmProviderName, "mock">, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5-mini",
};

export function resolveLlmModel(provider: LlmProviderName, override: string | undefined): string {
  if (override && override.trim() !== "") return override.trim();
  return provider === "openai" ? DEFAULT_MODELS.openai : DEFAULT_MODELS.anthropic;
}

const llmProvider = (process.env.LLM_PROVIDER || "mock") as LlmProviderName;

export const env = {
  port: Number(process.env.PORT ?? 4000),
  llmProvider,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  llmModel: resolveLlmModel(llmProvider, process.env.LLM_MODEL),
  simSpeed: Number(process.env.SIM_SPEED ?? 120),
  fuelPriceEurPerT: Number(process.env.FUEL_PRICE_EUR_PER_T ?? 600),
  co2Factor: Number(process.env.CO2_FACTOR ?? 3.114),
};
