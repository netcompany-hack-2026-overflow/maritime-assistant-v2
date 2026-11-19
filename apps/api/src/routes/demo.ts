import { Router } from "express";
import { resetDemo } from "../services/demoReset.js";

export const demoRouter = Router();

/** Settings → "Επαναφορά demo". Body must be { "confirm": "RESET" } so it can't fire by accident. */
demoRouter.post("/reset", async (req, res, next) => {
  try {
    if (req.body?.confirm !== "RESET") {
      return res.status(400).json({ error: "Στείλτε { \"confirm\": \"RESET\" } για επιβεβαίωση." });
    }
    res.json(await resetDemo());
  } catch (err) {
    next(err);
  }
});
