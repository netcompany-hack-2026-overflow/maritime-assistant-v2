import type { Prisma, PrismaClient } from "@prisma/client";
import { draftBunkerReplies, type BunkerPlan } from "@maritime/shared";

type Db = Pick<PrismaClient, "emailDraft"> | Pick<Prisma.TransactionClient, "emailDraft">;

/**
 * Write the reply drafts for a bunker plan. Drafts a person has edited are
 * kept as they are; once any reply has been sent nothing is touched.
 */
export async function syncBunkerDrafts(db: Db, recommendationId: string, plan: BunkerPlan, atSea = true) {
  // No replies are written for a ship that is no longer on its voyage.
  if (!atSea) return;
  const existing = await db.emailDraft.findMany({ where: { recommendationId } });
  if (existing.some((d) => d.status === "SENT")) return;

  const kept = existing.filter((d) => d.edited && d.status === "DRAFT");
  const keyOf = (d: { kind: string; optionKey: string | null }) => `${d.kind}:${d.optionKey ?? ""}`;
  const keptKeys = new Set(kept.map(keyOf));

  await db.emailDraft.deleteMany({ where: { recommendationId, status: "DRAFT", edited: false } });
  const specs = draftBunkerReplies(plan).filter((s) => !keptKeys.has(keyOf(s)));
  if (specs.length > 0) {
    await db.emailDraft.createMany({
      data: specs.map((s) => ({
        recommendationId,
        kind: s.kind,
        optionKey: s.optionKey,
        toAddr: s.toAddr,
        subject: s.subject,
        body: s.body,
      })),
    });
  }
}
