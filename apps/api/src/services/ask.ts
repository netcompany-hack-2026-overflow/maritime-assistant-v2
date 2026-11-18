import { bunkerVerdictReason, type Answer, type BunkerCalc } from "@maritime/shared";
import { prisma } from "../lib/prisma.js";
import type { CitableRow } from "../llm/types.js";

/**
 * Flattens every table the Q&A feature can answer from into a single
 * citable-row list, denormalizing relation names (vessel/port names) so the
 * LLM and the mock provider's keyword matching can read them without joins.
 */
export async function buildCitableRows(): Promise<CitableRow[]> {
  const [vessels, ports, voyages, emails, portEvents, recommendations] = await Promise.all([
    prisma.vessel.findMany(),
    prisma.port.findMany(),
    prisma.voyage.findMany({ include: { vessel: true, originPort: true, destPort: true } }),
    prisma.email.findMany(),
    prisma.portEvent.findMany({ include: { port: true, voyage: { include: { vessel: true } } } }),
    prisma.recommendation.findMany({
      include: {
        voyage: { include: { vessel: true, destPort: true } },
        portEvent: { include: { port: true } },
      },
    }),
  ]);

  const rows: CitableRow[] = [];

  for (const v of vessels) {
    rows.push({
      table: "vessel",
      id: v.id,
      data: { name: v.name, imo: v.imo, type: v.type, designSpeedKn: v.designSpeedKn, minSpeedKn: v.minSpeedKn },
    });
  }

  for (const p of ports) {
    rows.push({ table: "port", id: p.id, data: { name: p.name, unlocode: p.unlocode, country: p.country } });
  }

  for (const voyage of voyages) {
    rows.push({
      table: "voyage",
      id: voyage.id,
      data: {
        vesselName: voyage.vessel.name,
        originPortName: voyage.originPort.name,
        destPortName: voyage.destPort.name,
        speedKn: voyage.speedKn,
        plannedEta: voyage.plannedEta.toISOString(),
        berthTime: voyage.berthTime?.toISOString() ?? null,
        status: voyage.status,
      },
    });
  }

  for (const email of emails) {
    rows.push({
      table: "email",
      id: email.id,
      data: { fromAddr: email.fromAddr, subject: email.subject, receivedAt: email.receivedAt.toISOString() },
    });
  }

  for (const portEvent of portEvents) {
    rows.push({
      table: "portEvent",
      id: portEvent.id,
      data: {
        eventType: portEvent.eventType,
        delayHours: portEvent.delayHours,
        newBerthTime: portEvent.newBerthTime?.toISOString() ?? null,
        fuelGrade: portEvent.fuelGrade,
        priceUsdPerT: portEvent.priceUsdPerT,
        qtyMaxT: portEvent.qtyMaxT,
        validUntil: portEvent.validUntil?.toISOString() ?? null,
        supplier: portEvent.supplier,
        portName: portEvent.port?.name ?? null,
        voyageId: portEvent.voyageId,
        vesselName: portEvent.voyage?.vessel.name ?? null,
      },
    });
  }

  for (const rec of recommendations) {
    const bunker = rec.actionType === "BUNKER_DETOUR" ? (rec.calc as unknown as BunkerCalc) : null;
    rows.push({
      table: "recommendation",
      id: rec.id,
      data: {
        actionType: rec.actionType,
        status: rec.status,
        rejectReason: rec.rejectReason,
        ...(bunker
          ? {
              verdict: bunker.verdict,
              notWorthItBecause: bunkerVerdictReason(bunker, rec.voyage.destPort.name),
            }
          : {}),
        currentSpeedKn: rec.currentSpeedKn,
        recommendedSpeedKn: rec.recommendedSpeedKn,
        fuelSavedT: rec.fuelSavedT,
        costSavedEur: rec.costSavedEur,
        co2SavedT: rec.co2SavedT,
        vesselName: rec.voyage.vessel.name,
        portName: rec.portEvent.port?.name ?? null,
        decidedAt: rec.decidedAt?.toISOString() ?? null,
        rationale: rec.rationale,
      },
    });
  }

  return rows;
}

/**
 * Drops citations the LLM invented (table+id pairs not present in the rows it
 * was given). If every citation turns out invalid, the answer is replaced
 * with the standard "can't answer" fallback rather than shown uncited.
 */
export function validateCitations(answer: Answer, rows: CitableRow[]): Answer {
  const validKeys = new Set(rows.map((r) => `${r.table}:${r.id}`));
  const validCitations = answer.citations.filter((c) => validKeys.has(`${c.table}:${c.id}`));

  if (answer.citations.length > 0 && validCitations.length === 0) {
    return { answer: "I can't answer that from the data.", citations: [] };
  }

  return { ...answer, citations: validCitations };
}
