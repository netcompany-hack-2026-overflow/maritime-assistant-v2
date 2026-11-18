import { Router } from "express";
import { z } from "zod";
import { getSettings, updatePriceSettings } from "../lib/settings.js";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    next(err);
  }
});

const updateSchema = z
  .object({
    fuelPriceEurPerT: z.number().finite().gt(0).lt(5000).optional(),
    usdEurRate: z.number().finite().gte(0.5).lte(2).optional(),
    euaPriceEurPerT: z.number().finite().gte(0).lt(1000).optional(),
  })
  .refine(
    (v) => v.fuelPriceEurPerT !== undefined || v.usdEurRate !== undefined || v.euaPriceEurPerT !== undefined,
    { message: "Nothing to update" }
  );

settingsRouter.put("/", async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          "Fuel price must be between 0 and 5000 €/t, the USD→EUR rate between 0.5 and 2, and the EUA price between 0 and 1000 €/t.",
        details: parsed.error.issues,
      });
    }
    res.json(await updatePriceSettings(parsed.data));
  } catch (err) {
    next(err);
  }
});
