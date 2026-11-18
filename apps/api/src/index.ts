import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { activeLlmProviderName } from "./llm/index.js";
import { portsRouter } from "./routes/ports.js";
import { vesselsRouter } from "./routes/vessels.js";
import { voyagesRouter } from "./routes/voyages.js";
import { emailsRouter } from "./routes/emails.js";
import { portEventsRouter } from "./routes/port-events.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { recordsRouter } from "./routes/records.js";
import { askRouter } from "./routes/ask.js";
import { settingsRouter } from "./routes/settings.js";
import { bunkerOffersRouter, emailDraftsRouter } from "./routes/bunker-offers.js";
import { getSettings } from "./lib/settings.js";
import { mailerStatus } from "./services/mailer.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/meta", async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      llmProvider: activeLlmProviderName(),
      simSpeed: env.simSpeed,
      fuelPriceEurPerT: settings.fuelPriceEurPerT,
      co2Factor: settings.co2Factor,
      emailProvider: mailerStatus(),
    });
  } catch (err) {
    next(err);
  }
});

app.use("/api/ports", portsRouter);
app.use("/api/vessels", vesselsRouter);
app.use("/api/voyages", voyagesRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/port-events", portEventsRouter);
app.use("/api/recommendations", recommendationsRouter);
app.use("/api/records", recordsRouter);
app.use("/api/ask", askRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/bunker-offers", bunkerOffersRouter);
app.use("/api/email-drafts", emailDraftsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  // Prisma connection/config failures: don't leak the raw client message to
  // the UI, say what is wrong in plain words instead.
  const name: string = err?.name ?? "";
  if (name === "PrismaClientInitializationError" || /DATABASE_URL/.test(err?.message ?? "")) {
    return res.status(503).json({
      error: "The database is not reachable. Check DATABASE_URL and that Postgres is running.",
      details: null,
    });
  }
  if (/timeout|timed out/i.test(name) || /timed out/i.test(err?.message ?? "")) {
    return res.status(504).json({
      error: "The language model took too long to answer. Please try again.",
      details: null,
    });
  }
  const status: number = err.status ?? 500;
  res.status(status).json({
    // 5xx messages can contain internals (SQL, stack-ish text); keep them in the log
    error: status >= 500 ? "Something went wrong on the server. See the API logs." : err.message,
    details: status >= 500 ? null : err.details ?? null,
  });
};
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});
