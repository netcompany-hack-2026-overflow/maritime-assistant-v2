import { extractText, getDocumentProxy } from "unpdf";

const PDF_MAGIC = "%PDF-";

export class DocumentError extends Error {}

/** True when the buffer starts with the PDF magic bytes. */
export function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, PDF_MAGIC.length).toString("latin1") === PDF_MAGIC;
}

/**
 * Extracts plain text from a text-based PDF (port notices, supplier quotes).
 * Scanned/image-only PDFs have no text layer and are rejected with a clear message.
 */
export async function pdfToText(buf: Buffer): Promise<string> {
  if (!looksLikePdf(buf)) throw new DocumentError("Το αρχείο δεν είναι PDF.");
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    // Per page, not mergePages: merging collapses every newline, and charter
    // parties are read clause by clause.
    const result = await extractText(pdf, { mergePages: false });
    text = (Array.isArray(result.text) ? result.text : [result.text]).join("\n\n");
  } catch {
    throw new DocumentError("Το PDF δεν διαβάστηκε. Μήπως έχει κωδικό ή είναι κατεστραμμένο;");
  }
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0) {
    throw new DocumentError("Το PDF δεν έχει κείμενο (σαρωμένη εικόνα;). Ανεβάστε PDF με κείμενο.");
  }
  return cleaned;
}

/** First non-empty line, used as the inbox subject for an uploaded document. */
export function subjectFromText(text: string, filename: string): string {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const base = firstLine.length > 0 ? firstLine : filename;
  return base.length > 120 ? `${base.slice(0, 117)}…` : base;
}
