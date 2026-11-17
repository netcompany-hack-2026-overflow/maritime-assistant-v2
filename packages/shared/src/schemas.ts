import { z } from "zod";

export const portEventExtractionSchema = z.object({
  eventType: z.enum(["BERTH_DELAY", "CONGESTION", "CLOSURE", "NONE"]),
  portName: z.string().nullable(),
  portUnlocode: z.string().nullable(),
  vesselNameMentioned: z.string().nullable(),
  delayHours: z.number().nullable(),
  newBerthTime: z.string().nullable(),
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
