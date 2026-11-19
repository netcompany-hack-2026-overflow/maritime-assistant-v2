import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendMail } from "../services/mailer.js";
import { NOT_AT_SEA_MESSAGE, isAtSea } from "../services/atSea.js";

/**
 * Notices drafted on approval. Edit, then either send them through the email
 * provider in .env (same one as the bunker-offer replies) or send them from
 * your own mail client and "mark as sent".
 */
export const outboundEmailsRouter = Router();

outboundEmailsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await prisma.outboundEmail.findMany({ orderBy: { createdAt: "desc" } }));
  } catch (err) {
    next(err);
  }
});

const editSchema = z.object({
  toAddrs: z.string().max(1000).optional(),
  ccAddrs: z.string().max(1000).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(20_000).optional(),
});

outboundEmailsRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Μη έγκυρο email", details: parsed.error.issues });
    const existing = await prisma.outboundEmail.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Το email δεν βρέθηκε" });
    if (existing.status !== "DRAFT") return res.status(409).json({ error: "Αλλάζουν μόνο τα πρόχειρα" });
    res.json(await prisma.outboundEmail.update({ where: { id: existing.id }, data: parsed.data }));
  } catch (err) {
    next(err);
  }
});

outboundEmailsRouter.post("/:id/send", async (req, res, next) => {
  try {
    const existing = await prisma.outboundEmail.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Το email δεν βρέθηκε" });
    if (existing.status !== "DRAFT") return res.status(409).json({ error: `Το email έχει ήδη ${existing.status === "SENT" ? "σταλεί" : "αποσυρθεί"}` });
    if (!existing.toAddrs.trim()) return res.status(400).json({ error: "Συμπληρώστε τη διεύθυνση των ναυλωτών στο «Προς» πριν την αποστολή." });
    const rec = await prisma.recommendation.findUnique({
      where: { id: existing.recommendationId },
      include: { voyage: { include: { vessel: true, destPort: true } } },
    });
    if (!rec || !isAtSea(rec.voyage)) return res.status(409).json({ error: NOT_AT_SEA_MESSAGE });
    const result = await sendMail({ to: existing.toAddrs, cc: existing.ccAddrs, subject: existing.subject, text: existing.body });
    const [updated] = await prisma.$transaction([
      prisma.outboundEmail.update({ where: { id: existing.id }, data: { status: "SENT", sentAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          entity: "outboundEmail",
          entityId: existing.id,
          action: "SENT",
          payload: {
            to: existing.toAddrs,
            cc: existing.ccAddrs,
            subject: existing.subject,
            deliveredTo: result.deliveredTo,
            messageId: result.messageId,
          },
        },
      }),
    ]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

outboundEmailsRouter.post("/:id/sent", async (req, res, next) => {
  try {
    const existing = await prisma.outboundEmail.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Το email δεν βρέθηκε" });
    if (existing.status !== "DRAFT") return res.status(409).json({ error: `Το email έχει ήδη ${existing.status === "SENT" ? "σταλεί" : "αποσυρθεί"}` });
    const [updated] = await prisma.$transaction([
      prisma.outboundEmail.update({ where: { id: existing.id }, data: { status: "SENT", sentAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          entity: "outboundEmail",
          entityId: existing.id,
          action: "MARKED_SENT",
          payload: { to: existing.toAddrs, cc: existing.ccAddrs, subject: existing.subject },
        },
      }),
    ]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
