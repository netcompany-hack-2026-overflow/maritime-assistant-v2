export const env = {
  port: Number(process.env.PORT ?? 4000),
  llmProvider: (process.env.LLM_PROVIDER ?? "mock") as "mock" | "anthropic" | "openai",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "claude-sonnet-5-5",
  simSpeed: Number(process.env.SIM_SPEED ?? 120),
  fuelPriceEurPerT: Number(process.env.FUEL_PRICE_EUR_PER_T ?? 600),
  co2Factor: Number(process.env.CO2_FACTOR ?? 3.114),
};
