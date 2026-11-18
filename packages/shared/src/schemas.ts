import { z } from "zod";

export const portEventExtractionSchema = z.object({
  eventType: z.enum(["BERTH_DELAY", "CONGESTION", "CLOSURE", "BUNKER_OFFER", "NONE"]),
  portName: z.string().nullable(),
  portUnlocode: z.string().nullable(),
  vesselNameMentioned: z.string().nullable(),
  delayHours: z.number().nullable(),
  newBerthTime: z.string().nullable(),
  // Bunker-offer fields. Optional so providers and evals written before
  // bunker offers existed still parse; parseExtraction fills them with null.
  fuelGrade: z.string().nullable().optional(),
  priceUsdPerT: z.number().nullable().optional(),
  qtyMinT: z.number().nullable().optional(),
  qtyMaxT: z.number().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceSpans: z.array(
    z.object({
      field: z.string(),
      text: z.string(),
    })
  ),
});

export type PortEventExtraction = z.infer<typeof portEventExtractionSchema>;

export const citationSchema = z.object({
  table: z.string(),
  id: z.string(),
});

export const answerSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
});

export type Answer = z.infer<typeof answerSchema>;

export const rationaleSchema = z.object({
  rationale: z.string(),
});

export type Rationale = z.infer<typeof rationaleSchema>;
