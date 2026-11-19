import { useState } from "react";
import { Check, Copy, Mail, Send } from "lucide-react";
import { api, type OutboundEmail } from "../lib/api.js";
import { useEmailProvider } from "../lib/emailProvider.js";
import "./NoticePanel.css";

interface Props {
  notice: OutboundEmail;
  onChange: (n: OutboundEmail) => void;
}

function mailtoHref(n: Pick<OutboundEmail, "toAddrs" | "ccAddrs" | "subject" | "body">): string {
  const params = new URLSearchParams();
  if (n.ccAddrs) params.set("cc", n.ccAddrs);
  params.set("subject", n.subject);
  params.set("body", n.body);
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  return `mailto:${encodeURIComponent(n.toAddrs).replace(/%2C/gi, ",").replace(/%40/g, "@")}?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * The notice to charterers and agent drafted on approval (step 4). The
 * operator reviews it, then sends it through the email provider in .env, or
 * from their own mail client and marks it sent.
 */
export function NoticePanel({ notice, onChange }: Props) {
  const [draft, setDraft] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = useEmailProvider();
  const editable = notice.status === "DRAFT";
  const dirty =
    draft.toAddrs !== notice.toAddrs ||
    draft.ccAddrs !== notice.ccAddrs ||
    draft.subject !== notice.subject ||
    draft.body !== notice.body;

  const run = async (fn: () => Promise<OutboundEmail>) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      setDraft(updated);
      onChange(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      api.updateOutboundEmail(notice.id, {
        toAddrs: draft.toAddrs,
        ccAddrs: draft.ccAddrs,
        subject: draft.subject,
        body: draft.body,
      })
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `To: ${draft.toAddrs}\nCc: ${draft.ccAddrs}\nSubject: ${draft.subject}\n\n${draft.body}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Δεν ήταν δυνατή η αντιγραφή στο πρόχειρο.");
    }
  };

  return (
    <section className="notice" aria-label="Ειδοποίηση προς ναυλωτές και πράκτορα">
      <div className="notice__head">
        <p className="label">
          <Mail size={12} aria-hidden="true" /> Ειδοποίηση προς ναυλωτές &amp; πράκτορα
        </p>
        <span className={`notice__status notice__status--${notice.status.toLowerCase()}`}>
          {notice.status === "DRAFT"
            ? "Πρόχειρο — δεν έχει σταλεί"
            : notice.status === "SENT"
              ? `Στάλθηκε ${notice.sentAt ? new Date(notice.sentAt).toLocaleString("el-GR") : ""}`
              : "Αποσύρθηκε (η έγκριση αναιρέθηκε)"}
        </span>
      </div>

      <div className="notice__fields">
        <label>
          <span>Προς</span>
          <input
            value={draft.toAddrs}
            placeholder="διεύθυνση ναυλωτών (δεν υπάρχει στο ναυλοσύμφωνο)"
            onChange={(e) => setDraft({ ...draft, toAddrs: e.target.value })}
            disabled={!editable}
          />
        </label>
        <label>
          <span>Cc</span>
          <input value={draft.ccAddrs} onChange={(e) => setDraft({ ...draft, ccAddrs: e.target.value })} disabled={!editable} />
        </label>
        <label>
          <span>Θέμα</span>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} disabled={!editable} />
        </label>
        <textarea
          aria-label="Κείμενο email"
          value={draft.body}
          rows={14}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          disabled={!editable}
        />
      </div>

      {error && <div className="error-state" role="alert">{error}</div>}

      {notice.status !== "WITHDRAWN" && (
        <div className="notice__actions">
          {editable && dirty && (
            <button className="btn" onClick={save} disabled={busy}>
              Αποθήκευση αλλαγών
            </button>
          )}
          <button className="btn" onClick={copy}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? "Αντιγράφηκε" : "Αντιγραφή"}
          </button>
          <a className="btn" href={mailtoHref(draft)}>
            <Mail size={14} aria-hidden="true" /> Άνοιγμα στο πρόγραμμα email
          </a>
          {editable && provider?.configured && (
            <button
              className="btn btn-primary"
              onClick={() => {
                const to = provider.redirectTo ? `${provider.redirectTo} (δοκιμαστική ανακατεύθυνση)` : draft.toAddrs;
                if (window.confirm(`Αποστολή του «${draft.subject}» προς ${to};`)) void run(() => api.sendOutboundEmail(notice.id));
              }}
              disabled={busy || dirty || !draft.toAddrs.trim()}
              title={dirty ? "Αποθηκεύστε πρώτα τις αλλαγές" : !draft.toAddrs.trim() ? "Συμπληρώστε πρώτα τη διεύθυνση των ναυλωτών" : undefined}
            >
              <Send size={14} aria-hidden="true" /> Αποστολή
            </button>
          )}
          {editable && (
            <button
              className={provider?.configured ? "btn" : "btn btn-primary"}
              onClick={() => run(() => api.markOutboundEmailSent(notice.id))}
              disabled={busy || dirty}
            >
              <Check size={14} aria-hidden="true" /> Σήμανση ως απεσταλμένο
            </button>
          )}
        </div>
      )}
    </section>
  );
}
