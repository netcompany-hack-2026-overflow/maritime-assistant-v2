import { useEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type EmailListItem, type ProcessEmailResult } from "../lib/api.js";
import { highlightSourceSpans } from "../lib/highlight.js";
import { bunkerCalc, confidenceWord, eurShort, EVENT_LABELS, isBunker } from "../lib/recommendationText.js";
import "./Inbox.css";

type StepState = "done" | "stopped";

function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children: React.ReactNode }) {
  return (
    <li className={`result-strip__step result-strip__step--${state}`}>
      <span className="result-strip__n" aria-hidden="true">{n}</span>
      <span>
        <span className="result-strip__title">{title}</span>
        <span className="result-strip__detail">{children}</span>
      </span>
    </li>
  );
}

/** Read → Matched → Recommendation, or where and why processing stopped. */
function ResultStrip({ result }: { result: ProcessEmailResult }) {
  const ev = result.portEvent;
  if (!ev) return null;
  const isOffer = ev.eventType === "BUNKER_OFFER";
  const port = ev.port?.name;

  if (ev.eventType === "NONE" || !port) {
    return (
      <ol className="result-strip" aria-label="What happened">
        <Step n={1} title="Read" state="stopped">
          {ev.eventType === "NONE" ? "No port event or fuel offer in this email." : "Couldn't tell which port this is about."}
        </Step>
      </ol>
    );
  }

  const v = result.matchedVoyage;
  const rec = result.recommendation;
  let recStep: React.ReactNode;
  if (!v) {
    recStep = null;
  } else if (!rec) {
    recStep = (
      <Step n={3} title="Recommendation" state="stopped">
        {isOffer ? "Not enough detail in the offer to price it." : "Nothing to gain: slowing down wouldn't save fuel."}
      </Step>
    );
  } else if (isBunker(rec) && bunkerCalc(rec).verdict === "NOT_WORTH_IT") {
    recStep = (
      <Step n={3} title="Recommendation" state="stopped">
        Not worth it ({eurShort(rec.costSavedEur, true)}).{" "}
        <Link to="/actions">See why →</Link>
      </Step>
    );
  } else {
    recStep = (
      <Step n={3} title="Recommendation" state="done">
        {isBunker(rec) ? `Worth it: net ${eurShort(rec.costSavedEur, true)}.` : `Saves ${eurShort(rec.costSavedEur)}.`}{" "}
        <Link to="/actions">Review →</Link>
      </Step>
    );
  }

  return (
    <ol className="result-strip" aria-label="What happened">
      <Step n={1} title="Read" state="done">
        {EVENT_LABELS[ev.eventType]} · {port}
        {ev.delayHours != null ? ` · +${ev.delayHours} h` : ""}
        {isOffer && ev.priceUsdPerT != null ? ` · $${ev.priceUsdPerT}/t` : ""}
      </Step>
      <Step n={2} title="Matched" state={v ? "done" : "stopped"}>
        {v
          ? `${v.vessel?.name} (${v.originPort?.name} → ${v.destPort?.name})`
          : isOffer
            ? `No ship passes near ${port}.`
            : `No ship heading to ${port}.`}
      </Step>
      {recStep}
    </ol>
  );
}

export function Inbox() {
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ProcessEmailResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState({ fromAddr: "", subject: "", body: "" });
  const [submittingCustom, setSubmittingCustom] = useState(false);

  const refresh = () => {
    return api
      .getEmails()
      .then((list) => {
        setEmails(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedEmail = emails.find((e) => e.id === selectedId) ?? null;
  const selectedResult = selectedId ? results[selectedId] : undefined;

  const handleSimulate = async () => {
    setSimulateError(null);
    try {
      const released = await api.simulateEmail();
      await refresh();
      setSelectedId(released.id);
    } catch (e) {
      setSimulateError((e as Error).message);
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setSimulateError(null);
    setUploading(true);
    try {
      const created = await api.uploadDocument(file);
      await refresh();
      setSelectedId(created.id);
    } catch (e) {
      setSimulateError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleProcess = async (emailId: string) => {
    setProcessingId(emailId);
    try {
      const result = await api.processEmail(emailId);
      setResults((prev) => ({ ...prev, [emailId]: result }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    if (
      selectedEmail &&
      selectedEmail.processed &&
      !results[selectedEmail.id] &&
      processingId !== selectedEmail.id
    ) {
      handleProcess(selectedEmail.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id, selectedEmail?.processed]);

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCustom(true);
    try {
      const created = await api.createEmail(customForm);
      await refresh();
      setSelectedId(created.id);
      setShowCustomForm(false);
      setCustomForm({ fromAddr: "", subject: "", body: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmittingCustom(false);
    }
  };

  return (
    <div className="page page--inbox">
      <div className="inbox-layout">
        <div className="inbox-layout__list">
          <div className="inbox-toolbar">
            <p className="label">Inbox</p>
            <div className="inbox-toolbar__actions">
              <button className="btn" onClick={() => setShowCustomForm((v) => !v)}>
                Paste email
              </button>
              <button
                className="btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <FileUp size={14} aria-hidden="true" />
                {uploading ? "Reading PDF…" : "Upload PDF"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="visually-hidden"
                tabIndex={-1}
                aria-label="Upload a PDF document"
                onChange={(e) => void handleUpload(e.target.files?.[0])}
              />
              <button className="btn btn-primary" onClick={handleSimulate}>
                Simulate incoming email
              </button>
            </div>
            <p className="inbox-toolbar__hint">
              Port notices and quotes as PDF work too.{" "}
              <a href="/samples/algeciras-berth-notice.pdf" download>
                Download a sample
              </a>
            </p>
          </div>
          {simulateError && <div className="error-state" role="alert">{simulateError}</div>}

          {showCustomForm && (
            <form className="custom-email-form" onSubmit={handleCustomSubmit}>
              <input
                placeholder="From address"
                aria-label="From address"
                type="email"
                value={customForm.fromAddr}
                onChange={(e) => setCustomForm({ ...customForm, fromAddr: e.target.value })}
                required
              />
              <input
                placeholder="Subject"
                aria-label="Subject"
                value={customForm.subject}
                onChange={(e) => setCustomForm({ ...customForm, subject: e.target.value })}
                required
              />
              <textarea
                placeholder="Body"
                aria-label="Email body"
                rows={4}
                value={customForm.body}
                onChange={(e) => setCustomForm({ ...customForm, body: e.target.value })}
                required
              />
              <button className="btn btn-primary" type="submit" disabled={submittingCustom}>
                {submittingCustom ? "Adding…" : "Add to inbox"}
              </button>
            </form>
          )}

          {loading ? (
            <div className="loading-state" role="status">Loading inbox…</div>
          ) : error ? (
            <div className="error-state" role="alert">{error}</div>
          ) : emails.length === 0 ? (
            <div className="empty-state">
              <p>No emails yet.</p>
              <button className="btn btn-primary" onClick={handleSimulate}>
                Simulate incoming email
              </button>
            </div>
          ) : (
            <ul className="email-list">
              {emails.map((email) => (
                <li key={email.id}>
                  <button
                    className={
                      email.id === selectedId
                        ? "email-list__item email-list__item--active"
                        : "email-list__item"
                    }
                    onClick={() => setSelectedId(email.id)}
                    aria-current={email.id === selectedId ? "true" : undefined}
                  >
                    <span
                      className={
                        email.processed
                          ? "email-list__dot email-list__dot--processed"
                          : "email-list__dot"
                      }
                    />
                    <span className="email-list__text">
                      <span className="email-list__subject">{email.subject}</span>
                      <span className="email-list__meta">
                        {email.fromAddr} · {new Date(email.receivedAt).toLocaleString()}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="inbox-layout__detail">
          {!selectedEmail ? (
            <div className="empty-state">Select an email to view it.</div>
          ) : (
            <>
              <div className="email-detail__header">
                <h2>{selectedEmail.subject}</h2>
                <p className="label">
                  From {selectedEmail.fromAddr} ·{" "}
                  {new Date(selectedEmail.receivedAt).toLocaleString()}
                </p>
                {!selectedEmail.processed && (
                  <button
                    className="btn btn-primary"
                    onClick={() => handleProcess(selectedEmail.id)}
                    disabled={processingId === selectedEmail.id}
                  >
                    {processingId === selectedEmail.id ? "Processing…" : "Process"}
                  </button>
                )}
              </div>

              <hr className="hairline" />

              <p className="email-detail__body">
                {selectedResult?.portEvent
                  ? highlightSourceSpans(
                      selectedEmail.body,
                      selectedResult.portEvent.sourceSpans
                    )
                  : selectedEmail.body}
              </p>

              {selectedResult?.portEvent && (
                <div className="extraction-card">
                  <ResultStrip result={selectedResult} />
                  {selectedResult.portEvent.eventType !== "NONE" && (
                    <details className="extraction-card__details">
                      <summary>Details the AI read from the email</summary>
                      <dl className="extraction-card__fields">
                        <div>
                          <dt>Event</dt>
                          <dd>{EVENT_LABELS[selectedResult.portEvent.eventType]}</dd>
                        </div>
                        <div>
                          <dt>Port</dt>
                          <dd>{selectedResult.portEvent.port?.name ?? "—"}</dd>
                        </div>
                        {selectedResult.portEvent.eventType === "BUNKER_OFFER" ? (
                          <>
                            <div>
                              <dt>Fuel</dt>
                              <dd>{selectedResult.portEvent.fuelGrade ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Price</dt>
                              <dd>
                                {selectedResult.portEvent.priceUsdPerT != null
                                  ? `$${selectedResult.portEvent.priceUsdPerT}/t`
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Quantity</dt>
                              <dd>
                                {selectedResult.portEvent.qtyMaxT != null
                                  ? selectedResult.portEvent.qtyMinT != null &&
                                    selectedResult.portEvent.qtyMinT !== selectedResult.portEvent.qtyMaxT
                                    ? `${selectedResult.portEvent.qtyMinT}–${selectedResult.portEvent.qtyMaxT} t`
                                    : `${selectedResult.portEvent.qtyMaxT} t`
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Valid until</dt>
                              <dd>
                                {selectedResult.portEvent.validUntil
                                  ? new Date(selectedResult.portEvent.validUntil).toLocaleString()
                                  : "—"}
                              </dd>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <dt>Delay</dt>
                              <dd>
                                {selectedResult.portEvent.delayHours != null
                                  ? `${selectedResult.portEvent.delayHours} h`
                                  : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>New berth time</dt>
                              <dd>
                                {selectedResult.portEvent.newBerthTime
                                  ? new Date(selectedResult.portEvent.newBerthTime).toLocaleString()
                                  : "—"}
                              </dd>
                            </div>
                          </>
                        )}
                        <div>
                          <dt>Confidence</dt>
                          <dd>{confidenceWord(selectedResult.portEvent.confidence)}</dd>
                        </div>
                      </dl>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
