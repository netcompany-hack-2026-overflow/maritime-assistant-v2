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

/** "true"/"1"/"yes" -> true; anything else (or unset) -> the fallback. */
export function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const smtpPort = Number(process.env.SMTP_PORT || 587);

/**
 * Outgoing email (SMTP) for sending the bunker-offer replies. Any SMTP
 * provider works: Gmail/Google Workspace, Outlook/Microsoft 365, SendGrid,
 * Mailgun, Amazon SES, Brevo... See .env.example.
 */
export const mailEnv = {
  host: process.env.SMTP_HOST?.trim() ?? "",
  port: smtpPort,
  /** TLS from the first byte (port 465). Port 587 uses STARTTLS with secure=false. */
  secure: envFlag(process.env.SMTP_SECURE, smtpPort === 465),
  user: process.env.SMTP_USER?.trim() ?? "",
  pass: process.env.SMTP_PASS ?? "",
  from: process.env.MAIL_FROM?.trim() ?? "",
  fromName: process.env.MAIL_FROM_NAME?.trim() || "Tidewise Operations",
  replyTo: process.env.MAIL_REPLY_TO?.trim() ?? "",
  /** Every sent reply is also BCC'd here (e.g. the ops mailbox), if set. */
  bcc: process.env.MAIL_BCC?.trim() ?? "",
  /** For testing: send everything here instead of to the supplier. */
  redirectTo: process.env.MAIL_REDIRECT_TO?.trim() ?? "",
};

export const env = {
  port: Number(process.env.PORT ?? 4000),
  llmProvider,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  llmModel: resolveLlmModel(llmProvider, process.env.LLM_MODEL),
  /** Per-request timeout for LLM calls; keeps a hung provider from stalling the demo. */
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30_000),
  simSpeed: Number(process.env.SIM_SPEED ?? 120),
  fuelPriceEurPerT: Number(process.env.FUEL_PRICE_EUR_PER_T ?? 600),
  co2Factor: Number(process.env.CO2_FACTOR ?? 3.114),
};
