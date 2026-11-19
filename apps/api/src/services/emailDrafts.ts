import type { Prisma } from "@prisma/client";
import type { BunkerPlan } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { sendMail } from "./mailer.js";
import { draftToDTO } from "./bunkerOffers.js";
import { NOT_TAKEN_PREFIX, closeAlternatives, describeOption, openAlternatives } from "./alternatives.js";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface DraftEdit {
  toAddr?: string;
  subject?: string;
  body?: string;
}

/** Save a person's edits. Edited drafts are kept when prices change and drafts are rewritten. */
export async function updateDraft(id: string, edit: DraftEdit) {
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) throw new HttpError(404, "Το πρόχειρο δεν βρέθηκε");
  if (draft.status !== "DRAFT") throw new HttpError(409, `Αυτό το email έχει ήδη ${draft.status === "SENT" ? "σταλεί" : "κλείσει"}`);
  const updated = await prisma.emailDraft.update({ where: { id }, data: { ...edit, edited: true } });
  return draftToDTO(updated);
}

/**
 * Send one reply through the email provider, then record what it means:
 * - ACCEPT approves the offer with that option (speed, ETA, savings),
 * - DECLINE rejects it,
 * - COUNTER leaves it pending until the supplier answers.
 * The other replies for the offer are marked superseded. Only one reply per offer is ever sent.
 */
export async function sendDraft(id: string) {
  const draft = await prisma.emailDraft.findUnique({
    where: { id },
    include: { recommendation: { include: { voyage: true, portEvent: { include: { port: true } } } } },
  });
  if (!draft) throw new HttpError(404, "Το πρόχειρο δεν βρέθηκε");
  if (draft.status === "SENT") throw new HttpError(409, "Αυτό το email έχει ήδη σταλεί");
  const rec = draft.recommendation;
  if (draft.status === "SUPERSEDED") {
    throw new HttpError(
      409,
      rec.rejectReason?.startsWith(NOT_TAKEN_PREFIX)
        ? `Η προσφορά έκλεισε (${rec.rejectReason}). Αναιρέστε εκείνη την έγκριση για να την αποδεχτείτε.`
        : "Έχει ήδη σταλεί άλλη απάντηση σε αυτή την προσφορά"
    );
  }
  if (draft.kind === "ACCEPT" && rec.status === "PENDING" && rec.voyage.status !== "UNDERWAY") {
    throw new HttpError(409, "Το ταξίδι δεν είναι πλέον σε εξέλιξη, οπότε η προσφορά δεν μπορεί να γίνει δεκτή");
  }

  let result: { messageId: string; deliveredTo: string };
  try {
    result = await sendMail({ to: draft.toAddr, subject: draft.subject, text: draft.body });
  } catch (err) {
    await prisma.emailDraft.update({ where: { id }, data: { lastError: (err as Error).message } });
    throw err;
  }

  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.emailDraft.update({
      where: { id },
      data: { status: "SENT", sentAt: now, messageId: result.messageId, lastError: null },
    }),
    prisma.emailDraft.updateMany({
      where: { recommendationId: rec.id, status: "DRAFT", id: { not: id } },
      data: { status: "SUPERSEDED" },
    }),
  ];

  if (rec.status === "PENDING" && draft.kind === "ACCEPT") {
    const plan = rec.bunkerPlan as unknown as BunkerPlan | null;
    const option = plan?.options.find((o) => o.key === draft.optionKey);
    // Accepting this offer is the ship's decision: its other open options close.
    const alternatives = await openAlternatives(rec);
    ops.push(...closeAlternatives(alternatives, describeOption(rec), now));
    ops.push(
      prisma.auditLog.create({
        data: {
          entity: "recommendation",
          entityId: rec.id,
          action: "APPROVED",
          payload: {
            voyageId: rec.voyageId,
            actionType: "BUNKER_DETOUR",
            via: "acceptance email",
            option: draft.optionKey,
            netEur: option?.calc.netEur ?? rec.costSavedEur,
            closedAlternatives: alternatives,
          },
        },
      })
    );
    ops.push(
      prisma.recommendation.update({
        where: { id: rec.id },
        data: {
          status: "APPROVED",
          decidedAt: now,
          chosenOption: draft.optionKey,
          // The figures of the option actually chosen, so "Saved to date" stays truthful.
          ...(option
            ? {
                recommendedSpeedKn: option.calc.speedBunkerKn,
                fuelSavedT: -option.calc.extraFuelT,
                costSavedEur: option.calc.netEur,
                co2SavedT: -option.calc.extraCo2T,
                calc: option.calc as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      })
    );
  } else if (rec.status === "PENDING" && draft.kind === "DECLINE") {
    ops.push(
      prisma.recommendation.update({
        where: { id: rec.id },
        data: { status: "REJECTED", decidedAt: now, rejectReason: `Απορρίφθηκε με email προς ${draft.toAddr}` },
      })
    );
  }

  ops.push(
    prisma.auditLog.create({
      data: {
        entity: "emailDraft",
        entityId: id,
        action: "SENT",
        payload: {
          recommendationId: rec.id,
          kind: draft.kind,
          optionKey: draft.optionKey,
          to: draft.toAddr,
          deliveredTo: result.deliveredTo,
          messageId: result.messageId,
        },
      },
    })
  );
  await prisma.$transaction(ops);

  const sent = await prisma.emailDraft.findUnique({ where: { id } });
  return { draft: draftToDTO(sent!), deliveredTo: result.deliveredTo };
}
