import { Router } from "express";
import { z } from "zod";
import { getSettings, updateFuelPrice } from "../lib/settings.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  fuelPriceEurPerT: z.number().finite().gt(0).lt(5000),
});

settingsRouter.put("/", async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Fuel price must be a number between 0 and 5000 €/t.",
        details: parsed.error.issues,
      });
    }
    res.json(await updateFuelPrice(parsed.data.fuelPriceEurPerT));
  } catch (err) {
    next(err);
  }
});
