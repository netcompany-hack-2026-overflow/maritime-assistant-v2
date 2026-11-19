import { Router } from "express";
import { param, validationResult } from "express-validator";
import { prisma } from "../lib/prisma.js";

export const recordsRouter = Router();

const TABLES = {
  email: () => prisma.email,
  portEvent: () => prisma.portEvent,
  voyage: () => prisma.voyage,
  vessel: () => prisma.vessel,
  port: () => prisma.port,
  recommendation: () => prisma.recommendation,
} as const;

type TableName = keyof typeof TABLES;

function isTableName(value: string): value is TableName {
  return value in TABLES;
}

recordsRouter.get(
  "/:table/:id",
  param("table").isString().trim().notEmpty(),
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Μη έγκυρο αίτημα", details: errors.array() });
      }
      const table = req.params?.table;
      const id = req.params?.id;
      if (!table || !id || !isTableName(table)) {
        return res.status(400).json({ error: `Άγνωστος πίνακας: ${table}` });
      }
      const delegate = TABLES[table]() as unknown as {
        findUnique: (args: { where: { id: string } }) => Promise<unknown>;
      };
      const record = await delegate.findUnique({ where: { id } });
      if (!record) {
        return res.status(404).json({ error: `Δεν βρέθηκε ${table} ${id}` });
      }
      res.json({ table, id, data: record });
    } catch (err) {
      next(err);
    }
  }
);
