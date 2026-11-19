import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  getVoyageInsurance,
  InsuranceError,
  sendInsuranceNotice,
  setInsuranceQuote,
  updateInsuranceNotice,
} from "../services/insurance.js";

/** Mounted at /api/voyages/:voyageId/insurance */
export const insuranceRouter = Router({ mergeParams: true });

const vid = (req: { params: unknown }) => (req.params as { voyageId: string }).voyageId;

function fail(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof InsuranceError) return res.status(err.status).json({ error: err.message });
  next(err);
}

insuranceRouter.get("/", async (req, res, next) => {
  try {
    res.json(await getVoyageInsurance(vid(req)));
  } catch (err) {
    fail(err, res, next);
  }
});

/** Ask the model for a fresh analysis (and a fresh draft, unless the draft was edited or sent). */
insuranceRouter.post("/analysis", async (req, res, next) => {
  try {
    res.json(await getVoyageInsurance(vid(req), { regenerate: true }));
  } catch (err) {
    fail(err, res, next);
  }
});

const quoteSchema = z.object({
  zoneId: z.string().trim().min(1).max(80),
  pct: z.number().finite().gt(0).lte(25).nullable(),
});

insuranceRouter.put("/quotes", async (req, res, next) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Το ποσοστό του broker πρέπει να είναι πάνω από 0 και έως 25% ανά 7 ημέρες." });
    }
    res.json(await setInsuranceQuote(vid(req), parsed.data.zoneId, parsed.data.pct));
  } catch (err) {
    fail(err, res, next);
  }
});

const noticeSchema = z.object({
  to: z.string().trim().min(3).max(500),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
});

insuranceRouter.put("/notice", async (req, res, next) => {
  try {
    const parsed = noticeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Συμπληρώστε παραλήπτη, θέμα και κείμενο." });
    res.json(await updateInsuranceNotice(vid(req), parsed.data));
  } catch (err) {
    fail(err, res, next);
  }
});

insuranceRouter.post("/notice/send", async (req, res, next) => {
  try {
    res.json(await sendInsuranceNotice(vid(req)));
  } catch (err) {
    fail(err, res, next);
  }
});
