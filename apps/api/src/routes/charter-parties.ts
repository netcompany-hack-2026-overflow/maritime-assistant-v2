import express, { Router } from "express";
import { z } from "zod";
import { charterPartyTermsSchema } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { DocumentError, pdfToText } from "../services/documentText.js";
import { saveCharterParty, toCharterPartyDTO, updateCharterParty } from "../services/charterParty.js";
import { recomputeVoyage } from "../services/scenarios.js";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Mounted at /api/voyages/:voyageId/charter-party */
export const charterPartyRouter = Router({ mergeParams: true });

const vid = (req: { params: unknown }) => (req.params as { voyageId: string }).voyageId;

async function requireVoyage(voyageId: string | undefined) {
  if (!voyageId) return null;
  return prisma.voyage.findUnique({ where: { id: voyageId } });
}

charterPartyRouter.get("/", async (req, res, next) => {
  try {
    const row = await prisma.charterParty.findUnique({ where: { voyageId: vid(req) } });
    if (!row) return res.status(404).json({ error: "No charter party on file for this voyage" });
    res.json(toCharterPartyDTO(row));
  } catch (err) {
    next(err);
  }
});

const textSchema = z.object({
  text: z.string().trim().min(50, "Paste the full charter party text").max(200_000),
  sourceName: z.string().trim().max(200).optional(),
});

/** Charter party as pasted text. */
charterPartyRouter.post("/", async (req, res, next) => {
  try {
    if (!(await requireVoyage(vid(req)))) return res.status(404).json({ error: "Voyage not found" });
    const parsed = textSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    res.status(201).json(await saveCharterParty(vid(req), parsed.data.text, parsed.data.sourceName ?? "Pasted text"));
  } catch (err) {
    next(err);
  }
});

/** Charter party as a text-based PDF (raw bytes, ?filename=). */
charterPartyRouter.post(
  "/document",
  express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }),
  async (req, res, next) => {
    try {
      if (!(await requireVoyage(vid(req)))) return res.status(404).json({ error: "Voyage not found" });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Send the PDF as the request body with Content-Type: application/pdf." });
      }
      const filename = String(req.query.filename ?? "charter-party.pdf").slice(0, 200);
      const text = await pdfToText(req.body);
      res.status(201).json(await saveCharterParty(vid(req), text, filename));
    } catch (err) {
      if (err instanceof DocumentError) return res.status(422).json({ error: err.message });
      next(err);
    }
  }
);

const patchSchema = z.object({
  terms: charterPartyTermsSchema.optional(),
  expectedOpsHours: z.number().finite().min(0).max(2000).nullable().optional(),
});

charterPartyRouter.patch("/", async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid terms", details: parsed.error.issues });
    const row = await prisma.charterParty.findUnique({ where: { voyageId: vid(req) } });
    if (!row) return res.status(404).json({ error: "No charter party on file for this voyage" });
    res.json(await updateCharterParty(vid(req), parsed.data));
  } catch (err) {
    next(err);
  }
});

charterPartyRouter.delete("/", async (req, res, next) => {
  try {
    const row = await prisma.charterParty.findUnique({ where: { voyageId: vid(req) } });
    if (!row) return res.status(404).json({ error: "No charter party on file for this voyage" });
    await prisma.charterParty.delete({ where: { id: row.id } });
    await recomputeVoyage(vid(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
