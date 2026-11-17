import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { processEmail } from "../services/emailProcessing.js";

export const emailsRouter = Router();

emailsRouter.get("/", async (_req, res, next) => {
  try {
    const emails = await prisma.email.findMany({
      where: { queued: false },
      orderBy: { receivedAt: "desc" },
    });
    res.json(emails);
  } catch (err) {
    next(err);
  }
});

emailsRouter.post(
  "/",
  body("fromAddr").isString().trim().notEmpty(),
  body("subject").isString().trim().notEmpty(),
  body("body").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Invalid email", details: errors.array() });
      }
      const { fromAddr, subject, body: emailBody } = req.body;
      const email = await prisma.email.create({
        data: { fromAddr, subject, body: emailBody, queued: false, processed: false },
      });
      res.status(201).json(email);
    } catch (err) {
      next(err);
    }
  }
);

emailsRouter.post("/simulate", async (_req, res, next) => {
  try {
    const next_ = await prisma.email.findFirst({
      where: { queued: true },
      orderBy: { createdAt: "asc" },
    });
    if (!next_) {
      return res.status(409).json({ error: "No queued emails left to simulate." });
    }
    const released = await prisma.email.update({
      where: { id: next_.id },
      data: { queued: false, receivedAt: new Date() },
    });
    res.json(released);
  } catch (err) {
    next(err);
  }
});

emailsRouter.post(
  "/:id/process",
  param("id").isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Invalid request", details: errors.array() });
      }
      const id = req.params?.id;
      if (!id) {
        return res.status(400).json({ error: "Invalid request", details: "Missing id" });
      }
      const result = await processEmail(id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
