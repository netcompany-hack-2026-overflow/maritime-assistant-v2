import { Router } from "express";
import { z } from "zod";
import { DEFAULT_TCO } from "@maritime/shared";
import { explainOffersWithAi, listBunkerOffers, simulateDemoQuotes } from "../services/bunkerOffers.js";
import { sendDraft, updateDraft } from "../services/emailDrafts.js";

export const bunkerOffersRouter = Router();

bunkerOffersRouter.get("/", async (req, res, next) => {
  try {
    const voyageId = typeof req.query.voyageId === "string" ? req.query.voyageId : undefined;
    res.json(await listBunkerOffers(voyageId));
  } catch (err) {
    next(err);
  }
});

/** The four demo supplier quotes (prisma/mock_demo_data.json), received now and processed. */
bunkerOffersRouter.post("/simulate", async (_req, res, next) => {
  try {
    res.status(201).json(await simulateDemoQuotes());
  } catch (err) {
    next(err);
  }
});

const assumptionsSchema = z.object({
  voyageId: z.string().min(1),
  stemQtyT: z.number().finite().gt(0).lte(20_000),
  charterUsdPerDay: z.number().finite().gte(0).lte(500_000),
  urgency: z.enum(["LOW", "NORMAL", "HIGH"]),
  etsEnabled: z.boolean(),
  etsPriceEurPerT: z.number().finite().gte(0).lte(1_000).default(DEFAULT_TCO.etsPriceEurPerT),
  financeRatePct: z.number().finite().gte(0).lte(100).default(DEFAULT_TCO.financeRatePct),
  standardPaymentDays: z.number().finite().gte(0).lte(365).default(DEFAULT_TCO.standardPaymentDays),
  reliabilityPctPerPoint: z.number().finite().gte(0).lte(10).default(DEFAULT_TCO.reliabilityPctPerPoint),
});

/** One model call, only when a person presses "Ask the AI": rewords the computed comparison. */
bunkerOffersRouter.post("/explain", async (req, res, next) => {
  try {
    const parsed = assumptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Μη έγκυρες παραδοχές", details: parsed.error.issues });
    }
    const { voyageId, ...assumptions } = parsed.data;
    res.json(await explainOffersWithAi(voyageId, assumptions));
  } catch (err) {
    next(err);
  }
});

export const emailDraftsRouter = Router();

const editSchema = z
  .object({
    toAddr: z.string().trim().email().optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((v) => v.toAddr !== undefined || v.subject !== undefined || v.body !== undefined, { message: "Δεν υπάρχει τίποτα για αλλαγή" });

emailDraftsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Ελέγξτε τη διεύθυνση παραλήπτη, το θέμα και το κείμενο.", details: parsed.error.issues });
    }
    res.json(await updateDraft(req.params.id, parsed.data));
  } catch (err) {
    next(err);
  }
});

emailDraftsRouter.post("/:id/send", async (req, res, next) => {
  try {
    res.json(await sendDraft(req.params.id));
  } catch (err) {
    next(err);
  }
});
