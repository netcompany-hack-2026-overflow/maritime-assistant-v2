import { readFileSync } from "node:fs";
import type { EmailDraft, Prisma, Supplier } from "@prisma/client";
import {
  DEFAULT_RELIABILITY,
  compareOffers,
  explainComparison,
  tcoOfferFromDTO,
  type BunkerCalc,
  type BunkerOfferDTO,
  type BunkerOptionKey,
  type BunkerPlan,
  type EmailDraftDTO,
  type OfferTerms,
  type TcoAssumptions,
  type TcoOffer,
} from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import { getLlmProvider } from "../llm/index.js";
import { processEmail } from "./emailProcessing.js";

const include = {
  voyage: { include: { vessel: true, originPort: true, destPort: true } },
  portEvent: { include: { email: true, port: true } },
  emailDrafts: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.RecommendationInclude;

type OfferRow = Prisma.RecommendationGetPayload<{ include: typeof include }>;

const EMPTY_TERMS: OfferTerms = {
  vesselImo: null,
  vesselEta: null,
  bargingType: null,
  bargingUsd: null,
  otherFeesUsd: null,
  paymentTerms: null,
  paymentDays: null,
  deliveryDelayHours: null,
  deliveryEarliest: null,
  quoteValidityMinutes: null,
  quoteFirmUntil: null,
  lines: [],
};

export function draftToDTO(d: EmailDraft): EmailDraftDTO {
  return {
    id: d.id,
    recommendationId: d.recommendationId,
    kind: d.kind,
    optionKey: (d.optionKey as BunkerOptionKey | null) ?? null,
    toAddr: d.toAddr,
    subject: d.subject,
    body: d.body,
    status: d.status,
    edited: d.edited,
    sentAt: d.sentAt?.toISOString() ?? null,
    messageId: d.messageId,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Our record of the supplier: by sender domain, then by the name it signs with. Unknown = default score. */
export function matchSupplier(suppliers: Supplier[], fromAddr: string, signedName: string | null) {
  const domain = fromAddr.split("@")[1]?.trim().toLowerCase() ?? "";
  const found =
    suppliers.find((s) => domain && s.emailDomain.toLowerCase() === domain) ??
    suppliers.find((s) => signedName && s.name.toLowerCase() === signedName.trim().toLowerCase());
  if (found) return { name: found.name, reliabilityScore: found.reliabilityScore, known: true };
  return { name: signedName ?? (domain || "Άγνωστος προμηθευτής"), reliabilityScore: DEFAULT_RELIABILITY, known: false };
}

function toDTO(r: OfferRow, suppliers: Supplier[]): BunkerOfferDTO {
  const ev = r.portEvent;
  return {
    recommendationId: r.id,
    status: r.status,
    chosenOption: (r.chosenOption as BunkerOptionKey | null) ?? null,
    rejectReason: r.rejectReason,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    rationale: r.rationale,
    voyage: {
      id: r.voyage.id,
      status: r.voyage.status,
      vesselName: r.voyage.vessel.name,
      vesselImo: r.voyage.vessel.imo,
      originPortName: r.voyage.originPort.name,
      destPortName: r.voyage.destPort.name,
      charterRateUsdPerDay: r.voyage.vessel.charterRateUsdPerDay,
    },
    email: {
      id: ev.email.id,
      fromAddr: ev.email.fromAddr,
      subject: ev.email.subject,
      receivedAt: ev.email.receivedAt.toISOString(),
    },
    port: { name: ev.port?.name ?? "?", unlocode: ev.port?.unlocode ?? "" },
    supplier: matchSupplier(suppliers, ev.email.fromAddr, ev.supplier),
    fuelGrade: ev.fuelGrade,
    priceUsdPerT: ev.priceUsdPerT ?? 0,
    qtyMinT: ev.qtyMinT,
    qtyMaxT: ev.qtyMaxT,
    validUntil: ev.validUntil?.toISOString() ?? null,
    terms: { ...EMPTY_TERMS, ...((ev.offerTerms as Partial<OfferTerms> | null) ?? {}) },
    plan: (r.bunkerPlan as unknown as BunkerPlan | null) ?? null,
    calc: r.calc as unknown as BunkerCalc,
    drafts: r.emailDrafts.map(draftToDTO),
  };
}

/** Every bunker offer, newest first (the page groups them by voyage). */
export async function listBunkerOffers(voyageId?: string): Promise<BunkerOfferDTO[]> {
  const [rows, suppliers] = await Promise.all([
    prisma.recommendation.findMany({
      where: { actionType: "BUNKER_DETOUR", ...(voyageId ? { voyageId } : {}) },
      orderBy: { createdAt: "desc" },
      include,
    }),
    prisma.supplier.findMany(),
  ]);
  return rows.map((r) => toDTO(r, suppliers));
}

interface DemoEmail {
  id: string;
  fromAddr: string;
  subject: string;
  body: string;
}

/** Same path from src/services (tsx) and dist/services (built). */
const DEMO_FILE = new URL("../../prisma/mock_demo_data.json", import.meta.url);

/**
 * Drop the four demo supplier quotes into the inbox, received now (so their
 * "firm for N minutes" countdowns are live), and run each through the pipeline.
 */
export async function simulateDemoQuotes() {
  const demo = JSON.parse(readFileSync(DEMO_FILE, "utf-8")) as { emails: DemoEmail[] };
  const results: Array<{ demoId: string; emailId: string; recommendationId: string | null; matchedVoyageId: string | null }> = [];
  for (const e of demo.emails) {
    const email = await prisma.email.create({
      data: { fromAddr: e.fromAddr, subject: e.subject, body: e.body, queued: false, processed: false, receivedAt: new Date() },
    });
    const r = await processEmail(email.id);
    results.push({
      demoId: e.id,
      emailId: email.id,
      recommendationId: r.recommendation?.id ?? null,
      matchedVoyageId: r.matchedVoyage?.id ?? null,
    });
  }
  return results;
}

/**
 * A model-written recommendation for one ship's offers, on request. The
 * numbers are computed here exactly as the page does; the model only words them.
 */
export async function explainOffersWithAi(voyageId: string, assumptions: TcoAssumptions) {
  const offers = (await listBunkerOffers(voyageId))
    .filter((o) => o.status !== "REJECTED")
    .map(tcoOfferFromDTO)
    .filter((o): o is TcoOffer => o !== null);
  const rows = compareOffers(offers, assumptions);
  const draft = explainComparison(rows);
  const vesselName = (await prisma.voyage.findUnique({ where: { id: voyageId }, include: { vessel: true } }))?.vessel.name ?? "το πλοίο";
  const text = await getLlmProvider().explainBunkerComparison({
    vesselName,
    assumptions: { ...assumptions },
    offers: rows.map((r) => ({
      rank: r.rank,
      supplier: r.offer.supplier,
      port: r.offer.portName,
      priceUsdPerT: r.offer.planInput.offer.priceUsdPerT,
      fitsSchedule: r.feasible,
      effectiveUsdPerT: r.effectiveUsdPerT === null ? null : Math.round(r.effectiveUsdPerT * 100) / 100,
      totalUsd: r.totalUsd === null ? null : Math.round(r.totalUsd),
      breakdownUsd: r.breakdown ? Object.fromEntries(Object.entries(r.breakdown).map(([k, v]) => [k, Math.round(v)])) : null,
      quoteFirmUntil: r.offer.terms.quoteFirmUntil,
      flags: r.flags,
    })),
    draft,
  });
  return { text, draft };
}
