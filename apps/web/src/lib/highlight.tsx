import type { ReactNode } from "react";
import type { SourceSpan } from "./api.js";

export function highlightSourceSpans(body: string, spans: SourceSpan[]): ReactNode[] {
  interface Range {
    start: number;
    end: number;
    field: string;
  }

  const ranges: Range[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const idx = body.indexOf(span.text);
    if (idx !== -1) {
      ranges.push({ start: idx, end: idx + span.text.length, field: span.field });
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      merged.push(r);
      lastEnd = r.end;
    }
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((r, i) => {
    if (r.start > cursor) nodes.push(body.slice(cursor, r.start));
    nodes.push(
      <mark key={i} title={r.field} className="inbox-highlight">
        {body.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  });
  if (cursor < body.length) nodes.push(body.slice(cursor));

  return nodes;
}
