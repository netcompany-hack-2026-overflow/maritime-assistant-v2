import { z } from "zod";

/**
 * Commercial terms read from a voyage charter party. Every field is nullable:
 * a CP that does not state a term leaves it null and the UI says so, instead
 * of the system inventing a default.
 */
export const charterPartyTermsSchema = z.object({
  /** e.g. "GENCON 1994 dated 2 November 2026" */
  reference: z.string().nullable(),
  chartererName: z.string().nullable(),
  chartererEmail: z.string().nullable(),
  agentEmail: z.string().nullable(),
  vesselName: z.string().nullable(),
  /** Laytime allowed at the discharge port, hours. */
  laytimeHours: z.number().nullable(),
  /** e.g. "SHINC", "SHEX". */
  laytimeBasis: z.string().nullable(),
  /** Notice of readiness turn time before laytime starts, hours. */
  norNoticeHours: z.number().nullable(),
  /** True when time waiting for a berth counts as laytime (WIBON / "time lost waiting for berth to count"). */
  waitingTimeCounts: z.boolean().nullable(),
  demurrageRatePerDay: z.number().nullable(),
  despatchRatePerDay: z.number().nullable(),
  /** ISO 4217, e.g. "USD". */
  currency: z.string().nullable(),
  jitClause: z.object({
    present: z.boolean(),
    /** e.g. "BIMCO Just In Time Arrival Clause 2021 (Clause 32)". */
    name: z.string().nullable(),
    /** Exact clause wording from the CP. */
    text: z.string().nullable(),
    /** Clause lets the vessel reduce speed to arrive at the berth time. */
    speedReductionPermitted: z.boolean().nullable(),
    /** Speed reduction needs a charterers' instruction / agreement first. */
    requiresChartererInstruction: z.boolean().nullable(),
  }),
  confidence: z.number().min(0).max(1),
  sourceSpans: z.array(z.object({ field: z.string(), text: z.string() })),
});

export type CharterPartyTerms = z.infer<typeof charterPartyTermsSchema>;

export interface CharterPartyDTO {
  id: string;
  voyageId: string;
  sourceName: string;
  text: string;
  terms: CharterPartyTerms;
  /** Expected cargo-operations time at the discharge berth, hours (operator input). */
  expectedOpsHours: number | null;
  createdAt: string;
  updatedAt: string;
}
