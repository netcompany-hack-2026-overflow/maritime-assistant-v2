import type { Prisma } from "@prisma/client";
import type { CharterPartyDTO, CharterPartyTerms } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getLlmProvider } from "../llm/index.js";
import { parseTerms, recomputeVoyage } from "./scenarios.js";

type Row = Prisma.CharterPartyGetPayload<object>;

export function toCharterPartyDTO(row: Row): CharterPartyDTO {
  return {
    id: row.id,
    voyageId: row.voyageId,
    sourceName: row.sourceName,
    text: row.text,
    terms: parseTerms(row.terms)!,
    expectedOpsHours: row.expectedOpsHours,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Default cargo-operations time: most of the laytime allowed, leaving a margin. */
export function defaultOpsHours(terms: CharterPartyTerms): number | null {
  return terms.laytimeHours != null ? Math.round(terms.laytimeHours * 0.8) : null;
}

/**
 * Read a charter party, store it on the voyage (replacing any earlier one) and
 * re-run pending recommendations so their contract figures use it.
 */
export async function saveCharterParty(voyageId: string, text: string, sourceName: string) {
  const terms = await getLlmProvider().extractCharterParty(text);
  const data = {
    sourceName,
    text,
    terms: terms as unknown as Prisma.InputJsonValue,
    expectedOpsHours: defaultOpsHours(terms),
  };
  const row = await prisma.charterParty.upsert({
    where: { voyageId },
    update: data,
    create: { voyageId, ...data },
  });
  await prisma.auditLog.create({
    data: { entity: "charterParty", entityId: row.id, action: "UPLOADED", payload: { voyageId, sourceName } },
  });
  const recomputed = await recomputeVoyage(voyageId);
  return { charterParty: toCharterPartyDTO(row), recomputedRecommendations: recomputed };
}

/** Operator corrections to extracted terms or the expected cargo-operations time. */
export async function updateCharterParty(
  voyageId: string,
  update: { terms?: CharterPartyTerms; expectedOpsHours?: number | null }
) {
  const row = await prisma.charterParty.update({
    where: { voyageId },
    data: {
      ...(update.terms ? { terms: update.terms as unknown as Prisma.InputJsonValue } : {}),
      ...(update.expectedOpsHours !== undefined ? { expectedOpsHours: update.expectedOpsHours } : {}),
    },
  });
  const recomputed = await recomputeVoyage(voyageId);
  return { charterParty: toCharterPartyDTO(row), recomputedRecommendations: recomputed };
}
