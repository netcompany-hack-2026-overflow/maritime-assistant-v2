import { Router } from "express";
import { body, validationResult } from "express-validator";
import { getLlmProvider } from "../llm/index.js";
import { buildCitableRows, validateCitations } from "../services/ask.js";

export const askRouter = Router();

askRouter.post(
  "/",
  body("question").isString().trim().isLength({ min: 1, max: 500 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Μη έγκυρο αίτημα", details: errors.array() });
      }
      const question = req.body?.question as string;
      const rows = await buildCitableRows();
      const provider = getLlmProvider();
      const raw = await provider.answerQuestion(question, rows);
      res.json(validateCitations(raw, rows));
    } catch (err) {
      next(err);
    }
  }
);
