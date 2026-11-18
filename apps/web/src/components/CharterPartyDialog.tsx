import { useEffect, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import type { CharterPartyDTO } from "@maritime/shared";
import { api, type VoyageListItem } from "../lib/api.js";
import { money } from "../lib/format.js";
import "./CharterPartyDialog.css";

interface Props {
  voyage: VoyageListItem;
  onClose: (changed: boolean) => void;
}

function yesNo(v: boolean | null): string {
  return v === true ? "yes" : v === false ? "no" : "not stated";
}

/** Upload or paste a voyage charter party; shows the terms read from it, each with its source words. */
export function CharterPartyDialog({ voyage, onClose }: Props) {
  const [cp, setCp] = useState<CharterPartyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "paste">("view");
  const [text, setText] = useState("");
  const [opsHours, setOpsHours] = useState("");
  const [changed, setChanged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getCharterParty(voyage.id)
      .then((c) => {
        setCp(c);
        setOpsHours(c?.expectedOpsHours != null ? String(c.expectedOpsHours) : "");
        if (!c) setMode("view");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [voyage.id]);

  const done = (res: { charterParty: CharterPartyDTO; recomputedRecommendations: number }) => {
    setCp(res.charterParty);
    setOpsHours(res.charterParty.expectedOpsHours != null ? String(res.charterParty.expectedOpsHours) : "");
    setChanged(true);
    setMode("view");
    setMessage(
      res.recomputedRecommendations > 0
        ? `Saved. ${res.recomputedRecommendations} pending recommendation${res.recomputedRecommendations === 1 ? "" : "s"} recalculated with these terms.`
        : "Saved."
    );
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    run(async () => done(await api.uploadCharterParty(voyage.id, file)));
  };

  const t = cp?.terms;
  const spanFor = (field: string) => t?.sourceSpans.find((s) => s.field === field)?.text;

  const rows: Array<[string, string, string | undefined]> = t
    ? [
        ["Reference", t.reference ?? "not stated", spanFor("reference")],
        ["Charterers", [t.chartererName, t.chartererEmail].filter(Boolean).join(" · ") || "not stated", spanFor("chartererName")],
        ["Agents (discharge)", t.agentEmail ?? "not stated", spanFor("agentEmail")],
        ["Laytime", t.laytimeHours != null ? `${t.laytimeHours} h${t.laytimeBasis ? ` ${t.laytimeBasis}` : ""}` : "not stated", spanFor("laytimeHours")],
        ["NOR turn time", t.norNoticeHours != null ? `${t.norNoticeHours} h` : "not stated (6 h assumed)", spanFor("norNoticeHours")],
        ["Waiting for berth counts", yesNo(t.waitingTimeCounts), spanFor("waitingTimeCounts")],
        ["Demurrage", t.demurrageRatePerDay != null ? `${money(t.demurrageRatePerDay, t.currency)} / day` : "not stated", spanFor("demurrageRatePerDay")],
        ["Despatch", t.despatchRatePerDay != null ? `${money(t.despatchRatePerDay, t.currency)} / day` : "not stated", spanFor("despatchRatePerDay")],
        [
          "JIT clause",
          t.jitClause.present
            ? `${t.jitClause.name ?? "present"} — speed reduction ${t.jitClause.speedReductionPermitted ? "permitted" : "not stated"}${t.jitClause.requiresChartererInstruction ? ", on charterers' instruction" : ""}`
            : "none: utmost despatch applies",
          spanFor("jitClause"),
        ],
      ]
    : [];

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && !busy && onClose(changed)}>
      <div className="modal cp-dialog" role="dialog" aria-modal="true" aria-labelledby="cp-dialog-title">
        <div className="cp-dialog__head">
          <div>
            <p className="label">Charter party</p>
            <h2 id="cp-dialog-title" className="cp-dialog__title">
              {voyage.vesselName} · {voyage.originPortName} → {voyage.destPortName}
            </h2>
          </div>
          <button className="vessel-drawer__close" onClick={() => onClose(changed)} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="loading-state" role="status">Loading…</div>
        ) : mode === "paste" ? (
          <>
            <textarea
              className="cp-dialog__paste"
              aria-label="Charter party text"
              autoFocus
              rows={14}
              placeholder="Paste the full charter party text (Part I boxes and additional clauses)…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="modal__actions">
              <button className="btn" onClick={() => setMode("view")} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || text.trim().length < 50}
                onClick={() => run(async () => done(await api.saveCharterPartyText(voyage.id, text)))}
              >
                {busy ? "Reading…" : "Read terms"}
              </button>
            </div>
          </>
        ) : (
          <>
            {cp ? (
              <>
                <p className="cp-dialog__source">
                  From <strong>{cp.sourceName}</strong> · confidence {Math.round(cp.terms.confidence * 100)}%
                </p>
                <dl className="cp-dialog__terms">
                  {rows.map(([k, v, src]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {v}
                        {src && <q className="cp-dialog__span">{src}</q>}
                      </dd>
                    </div>
                  ))}
                </dl>
                <form
                  className="cp-dialog__ops"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = opsHours.trim() === "" ? null : Number(opsHours);
                    if (n !== null && (!Number.isFinite(n) || n < 0)) return setError("Cargo-operations hours must be a positive number.");
                    run(async () => done(await api.updateCharterParty(voyage.id, { expectedOpsHours: n })));
                  }}
                >
                  <label>
                    <span>Expected cargo operations at the berth</span>
                    <input type="number" min={0} step="1" value={opsHours} onChange={(e) => setOpsHours(e.target.value)} />
                    <span>h</span>
                  </label>
                  <button className="btn" type="submit" disabled={busy || String(cp.expectedOpsHours ?? "") === opsHours}>
                    Update
                  </button>
                </form>
              </>
            ) : (
              <p className="empty-state">
                No charter party yet. Upload the PDF (or paste the text) and Tidewise reads laytime, NOR, demurrage/despatch
                and any just-in-time arrival clause, then checks every scenario against them.
              </p>
            )}

            {error && <div className="error-state" role="alert">{error}</div>}
            {message && <div className="settings-card__ok" role="status">{message}</div>}

            <div className="modal__actions cp-dialog__actions">
              <a className="cp-dialog__sample" href="/samples/cycladic-wind-charter-party.pdf" download>
                Sample CP (PDF)
              </a>
              <button className="btn" onClick={() => setMode("paste")} disabled={busy}>
                Paste text
              </button>
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <FileUp size={14} aria-hidden="true" /> {busy ? "Reading…" : cp ? "Replace PDF" : "Upload PDF"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
