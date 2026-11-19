import { prisma } from "../lib/prisma.js";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Delete an email and what was made from it (port event, pending or declined
 * recommendations, unsent drafts and notices). Refused when it led to an
 * approved decision or an email has already gone out, so no decision history
 * disappears.
 */
export async function deleteEmail(id: string) {
  const email = await prisma.email.findUnique({ where: { id } });
  if (!email) throw new HttpError(404, "Το email δεν βρέθηκε");

  const events = await prisma.portEvent.findMany({ where: { emailId: id }, select: { id: true } });
  const recs = await prisma.recommendation.findMany({
    where: { portEventId: { in: events.map((e) => e.id) } },
    select: { id: true, status: true },
  });
  const recIds = recs.map((r) => r.id);
  if (recs.some((r) => r.status === "APPROVED")) {
    throw new HttpError(409, "Από αυτό το email προέκυψε εγκεκριμένη σύσταση. Αναιρέστε πρώτα την έγκριση στις Ενέργειες.");
  }
  const sent =
    (await prisma.emailDraft.count({ where: { recommendationId: { in: recIds }, status: "SENT" } })) +
    (await prisma.outboundEmail.count({ where: { recommendationId: { in: recIds }, status: "SENT" } }));
  if (sent > 0) throw new HttpError(409, "Έχει ήδη σταλεί email για αυτό το θέμα, οπότε δεν διαγράφεται.");

  await prisma.$transaction([
    prisma.emailDraft.deleteMany({ where: { recommendationId: { in: recIds } } }),
    prisma.outboundEmail.deleteMany({ where: { recommendationId: { in: recIds } } }),
    prisma.recommendation.deleteMany({ where: { id: { in: recIds } } }),
    prisma.portEvent.deleteMany({ where: { emailId: id } }),
    prisma.email.delete({ where: { id } }),
    prisma.auditLog.create({
      data: {
        entity: "email",
        entityId: id,
        action: "DELETED",
        payload: { subject: email.subject, fromAddr: email.fromAddr, recommendations: recIds },
      },
    }),
  ]);
}
