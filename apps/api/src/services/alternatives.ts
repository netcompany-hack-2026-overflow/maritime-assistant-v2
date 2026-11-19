import type { Prisma } from "@prisma/client";
import { NOT_TAKEN_PREFIX } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";

export { NOT_TAKEN_PREFIX };

/**
 * One decision per ship: the pending recommendations for a voyage (a speed
 * change, each bunker offer, ...) are alternatives. Approving one closes the
 * others, so two plans for the same ship can never both be approved; undoing
 * the approval reopens them.
 */

type RecLike = {
  actionType: string;
  portEvent?: { eventType: string; supplier?: string | null; port?: { name: string } | null } | null;
};

const EVENT_WORDS: Record<string, string> = {
  BERTH_DELAY: "την καθυστέρηση πρόσδεσης",
  CONGESTION: "τη συμφόρηση",
  CLOSURE: "το κλείσιμο",
};

/** «ο ανεφοδιασμός στο Algeciras (Strait Bunkering Ltd)» ή «η αλλαγή ταχύτητας για την καθυστέρηση πρόσδεσης στο Rotterdam». */
export function describeOption(rec: RecLike): string {
  const ev = rec.portEvent;
  const port = ev?.port?.name ?? "το λιμάνι";
  if (rec.actionType === "BUNKER_DETOUR") return `ο ανεφοδιασμός στο ${port}${ev?.supplier ? ` (${ev.supplier})` : ""}`;
  return `η αλλαγή ταχύτητας για ${EVENT_WORDS[ev?.eventType ?? ""] ?? "το συμβάν"} στο ${port}`;
}

/** The other options still open for the same ship. */
export async function openAlternatives(rec: { id: string; voyageId: string }): Promise<string[]> {
  const rows = await prisma.recommendation.findMany({
    where: { voyageId: rec.voyageId, status: "PENDING", id: { not: rec.id } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Writes that close them; add these to the approval's transaction. */
export function closeAlternatives(ids: string[], chosen: string, now: Date): Prisma.PrismaPromise<unknown>[] {
  if (ids.length === 0) return [];
  return [
    prisma.recommendation.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: now, rejectReason: `${NOT_TAKEN_PREFIX}εγκρίθηκε ${chosen} για αυτό το πλοίο` },
    }),
    // Their acceptances and counter-offers can't go out any more; a polite decline still can.
    prisma.emailDraft.updateMany({
      where: { recommendationId: { in: ids }, status: "DRAFT", kind: { not: "DECLINE" } },
      data: { status: "SUPERSEDED" },
    }),
  ];
}

/**
 * Writes that reopen the options an approval closed, for when it is undone.
 * An option that has had a reply sent since (e.g. a decline) stays closed.
 */
export function reopenAlternatives(ids: string[]): Prisma.PrismaPromise<unknown>[] {
  if (ids.length === 0) return [];
  const closedByApproval = {
    status: "REJECTED" as const,
    rejectReason: { startsWith: NOT_TAKEN_PREFIX },
    emailDrafts: { none: { status: "SENT" as const } },
  };
  return [
    // Drafts first, while their offer still carries the "not taken" mark.
    prisma.emailDraft.updateMany({
      where: { recommendationId: { in: ids }, status: "SUPERSEDED", recommendation: closedByApproval },
      data: { status: "DRAFT" },
    }),
    prisma.recommendation.updateMany({
      where: { id: { in: ids }, ...closedByApproval },
      data: { status: "PENDING", decidedAt: null, rejectReason: null },
    }),
  ];
}

/** The ids an approval closed, from its audit entry. */
export async function closedByApproval(recommendationId: string): Promise<string[]> {
  const log = await prisma.auditLog.findFirst({
    where: { entity: "recommendation", entityId: recommendationId, action: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  const ids = (log?.payload as { closedAlternatives?: unknown } | null)?.closedAlternatives;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}
