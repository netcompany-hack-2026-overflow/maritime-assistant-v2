import { useEffect, useMemo, useState } from "react";
import type { EmailDraftDTO, EmailProviderStatus } from "@maritime/shared";
import { api } from "../lib/api.js";

interface EmailDraftEditorProps {
  drafts: EmailDraftDTO[];
  provider: EmailProviderStatus | null;
  /** Called after a save or a send so the page can reload the offer. */
  onChanged: () => Promise<void> | void;
}

function draftLabel(d: EmailDraftDTO): string {
  if (d.kind === "ACCEPT") return d.optionKey === "KEEP_SPEED" ? "Accept · keep speed" : "Accept · eco speed";
  if (d.kind === "COUNTER") return "Counter-offer";
  return "Decline";
}

/**
 * The replies the agent wrote for one offer. Pick one, edit it if needed,
 * send it. Sending one closes the others.
 */
export function EmailDraftEditor({ drafts, provider, onChanged }: EmailDraftEditorProps) {
  const sent = drafts.find((d) => d.status === "SENT") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = drafts.find((d) => d.id === selectedId) ?? sent ?? drafts[0] ?? null;
  const [form, setForm] = useState({ toAddr: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (selected) setForm({ toAddr: selected.toAddr, subject: selected.subject, body: selected.body });
    setError(selected?.lastError ?? null);
    // Reset only when another draft is picked or the stored text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt]);

  const dirty = useMemo(
    () => !!selected && (form.toAddr !== selected.toAddr || form.subject !== selected.subject || form.body !== selected.body),
    [form, selected]
  );

  if (drafts.length === 0 || !selected) {
    return <p className="drafts__empty">No reply drafts for this offer.</p>;
  }

  const editable = selected.status === "DRAFT";
  const canSend = editable && !sent && !!provider?.configured;

  const save = async () => {
    await api.updateEmailDraft(selected.id, form);
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await save();
      setInfo("Saved.");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    const to = provider?.redirectTo ? `${provider.redirectTo} (test redirect for ${form.toAddr})` : form.toAddr;
    if (!window.confirm(`Send "${form.subject}" to ${to}?`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (dirty) await save();
      const res = await api.sendEmailDraft(selected.id);
      setInfo(`Sent to ${res.deliveredTo}.`);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${form.toAddr}\nSubject: ${form.subject}\n\n${form.body}`);
      setInfo("Copied to the clipboard.");
    } catch {
      setError("Couldn't copy; select the text and copy it by hand.");
    }
  };

  return (
    <div className="drafts">
      <div className="drafts__tabs" role="tablist" aria-label="Reply drafts">
        {drafts.map((d) => (
          <button
            key={d.id}
            role="tab"
            aria-selected={d.id === selected.id}
            className={d.id === selected.id ? "drafts__tab drafts__tab--active" : "drafts__tab"}
            onClick={() => {
              setSelectedId(d.id);
              setInfo(null);
            }}
          >
            {draftLabel(d)}
            {d.status === "SENT" && <span className="chip chip--ok">sent</span>}
            {d.status === "SUPERSEDED" && <span className="chip">not sent</span>}
            {d.status === "DRAFT" && d.edited && <span className="chip">edited</span>}
          </button>
        ))}
      </div>

      <div className="drafts__form" role="tabpanel">
        <label className="drafts__field">
          <span>To</span>
          <input
            type="email"
            value={form.toAddr}
            disabled={!editable || busy}
            onChange={(e) => setForm({ ...form, toAddr: e.target.value })}
          />
        </label>
        <label className="drafts__field">
          <span>Subject</span>
          <input value={form.subject} disabled={!editable || busy} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </label>
        <label className="drafts__field">
          <span>Message</span>
          <textarea
            rows={14}
            value={form.body}
            disabled={!editable || busy}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </label>

        {selected.status === "SENT" && selected.sentAt && (
          <p className="drafts__note">Sent {new Date(selected.sentAt).toLocaleString()}.</p>
        )}
        {selected.status === "SUPERSEDED" && <p className="drafts__note">Not sent: another reply to this offer went out.</p>}
        {editable && !provider?.configured && (
          <p className="drafts__note drafts__note--warn">
            Sending needs the email provider. Fill in {provider?.missing.join(", ") || "SMTP_HOST, MAIL_FROM"} in <code>.env</code>{" "}
            and restart the API. Until then you can copy the text.
          </p>
        )}
        {editable && provider?.redirectTo && (
          <p className="drafts__note">Test mode: emails go to {provider.redirectTo} (MAIL_REDIRECT_TO), not to the supplier.</p>
        )}
        {error && <div className="error-state" role="alert">{error}</div>}
        {info && <p className="drafts__note drafts__note--ok" role="status">{info}</p>}

        <div className="drafts__actions">
          {editable && (
            <button className="btn btn-primary" onClick={handleSend} disabled={!canSend || busy}>
              {busy ? "Working…" : "Send"}
            </button>
          )}
          {editable && (
            <button className="btn" onClick={handleSave} disabled={!dirty || busy}>
              Save changes
            </button>
          )}
          <button className="btn" onClick={handleCopy} disabled={busy}>
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
