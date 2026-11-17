import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { portsRouter } from "./routes/ports.js";
import { vesselsRouter } from "./routes/vessels.js";
import { voyagesRouter } from "./routes/voyages.js";
import { emailsRouter } from "./routes/emails.js";
import { portEventsRouter } from "./routes/port-events.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/meta", (_req, res) => {
  res.json({
    llmProvider: env.llmProvider,
    simSpeed: env.simSpeed,
    fuelPriceEurPerT: env.fuelPriceEurPerT,
    co2Factor: env.co2Factor,
  });
});

app.use("/api/ports", portsRouter);
app.use("/api/vessels", vesselsRouter);
app.use("/api/voyages", voyagesRouter);
app.use("/api/emails", emailsRouter);
app.use("/api/port-events", portEventsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(err.status ?? 500).json({
    error: err.message ?? "Internal server error",
    details: err.details ?? null,
  });
};
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`API listening on port ${env.port}`);
});
