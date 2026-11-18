import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { approveRecommendation, rejectRecommendation, undoApproval } from "../services/recommendations.js";

export const recommendationsRouter = Router();

const include = {
  voyage: { include: { vessel: true, originPort: true, destPort: true } },
  portEvent: { include: { email: true, port: true } },
  emailDrafts: { orderBy: { createdAt: "asc" } },
} as const;

recommendationsRouter.get(
  "/",
  query("status").optional().isIn(["PENDING", "APPROVED", "REJECTED"]),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Invalid query", details: errors.array() });
      }
      const status = req.query?.status as "PENDING" | "APPROVED" | "REJECTED" | undefined;
      const recommendations = await prisma.recommendation.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: "desc" },
        include,
      });
      res.json(recommendations);
    } catch (err) {
      next(err);
    }
  }
);

recommendationsRouter.get(
  "/:id",
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const id = req.params?.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });
      const recommendation = await prisma.recommendation.findUnique({
        where: { id },
        include,
      });
      if (!recommendation) {
        return res.status(404).json({ error: "Recommendation not found" });
      }
      res.json(recommendation);
    } catch (err) {
      next(err);
    }
  }
);

recommendationsRouter.post(
  "/:id/approve",
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const id = req.params?.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });
      const result = await approveRecommendation(id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

recommendationsRouter.post(
  "/:id/undo",
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const id = req.params?.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });
      const result = await undoApproval(id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

recommendationsRouter.post(
  "/:id/reject",
  param("id").isString().trim().notEmpty(),
  body("reason").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Invalid request", details: errors.array() });
      }
      const id = req.params?.id;
      if (!id) return res.status(400).json({ error: "Invalid request" });
      const result = await rejectRecommendation(id, req.body.reason);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
