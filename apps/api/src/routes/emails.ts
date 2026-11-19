import express, { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { prisma } from "../lib/prisma.js";
import { processEmail } from "../services/emailProcessing.js";
import { deleteEmail } from "../services/emailDelete.js";
import { DocumentError, pdfToText, subjectFromText } from "../services/documentText.js";

const MAX_PDF_BYTES = 5 * 1024 * 1024;

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
        return res.status(400).json({ error: "Μη έγκυρο email", details: errors.array() });
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

/**
 * Upload a PDF document (berth notice, port circular, supplier quote). Its text
 * layer becomes an inbox item that goes through the same extract → match →
 * recommend pipeline as an email. Body: raw PDF bytes; ?filename= for display.
 */
emailsRouter.post(
  "/document",
  express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Στείλτε το PDF ως σώμα του αιτήματος με Content-Type: application/pdf." });
      }
      const filename = String(req.query.filename ?? "document.pdf").slice(0, 200);
      const text = await pdfToText(req.body);
      const email = await prisma.email.create({
        data: {
          fromAddr: `Uploaded document · ${filename}`,
          subject: subjectFromText(text, filename),
          body: text,
          queued: false,
          processed: false,
        },
      });
      res.status(201).json(email);
    } catch (err) {
      if (err instanceof DocumentError) {
        return res.status(422).json({ error: err.message });
      }
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
      return res.status(409).json({ error: "Δεν υπάρχουν άλλα emails στην ουρά για προσομοίωση." });
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
        return res.status(400).json({ error: "Μη έγκυρο αίτημα", details: errors.array() });
      }
      const id = req.params?.id;
      if (!id) {
        return res.status(400).json({ error: "Μη έγκυρο αίτημα", details: "Missing id" });
      }
      const result = await processEmail(id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/** Delete an email and what was made from it; see services/emailDelete.ts for what is refused. */
emailsRouter.delete("/:id", param("id").isString().trim().notEmpty(), async (req, res, next) => {
  try {
    const id = req.params?.id;
    if (!id) return res.status(400).json({ error: "Μη έγκυρο αίτημα" });
    await deleteEmail(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
