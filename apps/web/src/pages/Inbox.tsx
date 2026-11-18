import { useEffect, useRef, useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type EmailListItem, type ProcessEmailResult } from "../lib/api.js";
import { highlightSourceSpans } from "../lib/highlight.js";
import "./Inbox.css";

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

const handleDeleteEmail = async (e: React.MouseEvent, emailId: string) => {
    e.stopPropagation();
    try {
      // Προσπαθούμε να το διαγράψουμε από τον server (αν υπάρχει)
      await api.deleteEmail(emailId).catch(() => {});
      
      // Καθαρίζουμε αμέσως το UI και τα αποτελέσματα τοπικά
      setEmails((prev) => prev.filter((item) => item.id !== emailId));
      setResults((prev) => {
        const copy = { ...prev };
        delete copy[emailId];
        return copy;
      });

      if (selectedId === emailId) {
        setSelectedId(null);
      }
    } catch (err) {
      setError((err as Error).message);
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
                <li key={email.id} className="email-list__item-container">
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
                  <button
                    className="email-list__delete"
                    title="Delete email"
                    aria-label="Delete email"
                    onClick={(e) => void handleDeleteEmail(e, email.id)}
                  >
                    <Trash2 size={14} />
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
                  <p className="label">Extraction</p>
                  {selectedResult.portEvent.eventType === "NONE" ? (
                    <p className="extraction-card__none">No port event found.</p>
                  ) : (
                    <>
                      <dl className="extraction-card__fields">
                        <div>
                          <dt>Event type</dt>
                          <dd>{selectedResult.portEvent.eventType}</dd>
                        </div>
                        <div>
                          <dt>Port</dt>
                          <dd>{selectedResult.portEvent.port?.name ?? "—"}</dd>
                        </div>
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
                        <div>
                          <dt>Confidence</dt>
                          <dd>{Math.round(selectedResult.portEvent.confidence * 100)}%</dd>
                        </div>
                      </dl>

                      {selectedResult.matchedVoyage ? (
                        <p className="extraction-card__match">
                          Affected: {selectedResult.matchedVoyage.vessel?.name} (
                          {selectedResult.matchedVoyage.originPort?.name} →{" "}
                          {selectedResult.matchedVoyage.destPort?.name})
                        </p>
                      ) : (
                        <p className="extraction-card__match extraction-card__match--none">
                          No matching underway voyage found.
                        </p>
                      )}

                      {selectedResult.recommendation && (
                        <Link className="extraction-card__action-link" to="/actions">
                          View action →
                        </Link>
                      )}
                    </>
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