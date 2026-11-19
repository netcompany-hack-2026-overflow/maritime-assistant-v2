import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Send, Sparkles } from "lucide-react";
import { api, type AskResponse, type Citation, type RecordResponse } from "../lib/api.js";
import "./Ask.css";

const EXAMPLE_QUESTIONS = [
  "Πόσο καύσιμο έχουμε γλιτώσει από τις εγκεκριμένες συστάσεις;",
  "Ποιο είναι το ETA του MV Aegean Star;",
  "Ποια πλοία επηρεάζονται από καθυστερήσεις λιμανιών;",
  "Γιατί δεν πήραμε την προσφορά της Γένοβας;",
  "Ποια πλοία έχουν κακό βαθμό CII;",
];

const STATUS_WORDS: Record<string, string> = {
  PENDING: "Σε αναμονή",
  APPROVED: "Εγκρίθηκε",
  REJECTED: "Απορρίφθηκε",
  UNDERWAY: "Σε εξέλιξη",
  ARRIVED: "Έφτασε",
  CANCELLED: "Ακυρώθηκε",
};

/** A cited record in words; the raw JSON stays one click away. */
function citationFacts(table: string, data: Record<string, unknown>): Array<{ k: string; v: string }> {
  if (table === "recommendation") {
    return [
      { k: "Είδος", v: data.actionType === "BUNKER_DETOUR" ? "Προσφορά καυσίμου" : "Αλλαγή ταχύτητας" },
      { k: "Κατάσταση", v: STATUS_WORDS[String(data.status)] ?? String(data.status ?? "—") },
      { k: "Καύσιμο", v: data.fuelSavedT != null ? `${Number(data.fuelSavedT).toFixed(1)} t` : "—" },
      { k: "Καθαρό", v: data.costSavedEur != null ? `€${Math.round(Number(data.costSavedEur)).toLocaleString("en-US")}` : "—" },
    ];
  }
  if (table === "voyage") {
    return [
      { k: "Κατάσταση", v: STATUS_WORDS[String(data.status)] ?? String(data.status ?? "—") },
      { k: "Ταχύτητα", v: data.speedKn != null ? `${Number(data.speedKn).toFixed(1)} kn` : "—" },
      { k: "ETA", v: data.plannedEta ? new Date(String(data.plannedEta)).toLocaleString("el-GR") : "—" },
    ];
  }
  return Object.entries(data)
    .filter(([k]) => !k.endsWith("Id") && k !== "id")
    .slice(0, 4)
    .map(([k, v]) => ({ k, v: String(v ?? "—") }));
}

interface Exchange {
  id: number;
  question: string;
  response: AskResponse;
}

function CitationChip({ citation }: { citation: Citation }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [record, setRecord] = useState<RecordResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!expanded && !record) {
      setLoading(true);
      try {
        setRecord(await api.getRecord(citation.table, citation.id));
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="citation-chip">
      <button className="citation-chip__toggle" onClick={toggle} aria-expanded={expanded}>
        <span>
          {citation.table} · {citation.id.slice(0, 8)}
        </span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="citation-card">
          {loading || !record ? (
            <span>Φόρτωση…</span>
          ) : (
            <>
              <div className="citation-kv-list">
                {citationFacts(citation.table, record.data as Record<string, unknown>).map((item) => (
                  <div key={item.k} className="citation-kv-row">
                    <span className="citation-kv-key">{item.k}</span>
                    <span className="citation-kv-val">{item.v}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="citation-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Απόκρυψη JSON" : "Προβολή JSON"}
              </button>
              {showRaw && <pre className="citation-chip__data">{JSON.stringify(record.data, null, 2)}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const usingMock = provider === "mock";

  useEffect(() => {
    let cancelled = false;
    api
      .getMeta()
      .then((m) => {
        if (!cancelled) setProvider(m.llmProvider);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.askQuestion(trimmed);
      setExchanges((prev) => [{ id: Date.now(), question: trimmed, response }, ...prev]);
      setQuestion("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--ask">
      {provider && !usingMock && (
        <p className="ask-notice" role="note">
          <Sparkles size={16} aria-hidden="true" />
          <span>Απαντά το γλωσσικό μοντέλο ({provider}) μόνο από τα δεδομένα του στόλου, με παραπομπή σε κάθε εγγραφή.</span>
        </p>
      )}
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          className="ask-form__input"
          type="text"
          placeholder="Κάντε μια ερώτηση για τον στόλο…"
          aria-label="Ερώτηση για τον στόλο"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          <Send size={14} />
          Ρώτα
        </button>
      </form>

      <div className="ask-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} className="ask-example" onClick={() => void ask(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>

      {usingMock && (
        <p className="ask-notice" role="note">
          Offline λειτουργία: δεν έχει οριστεί κλειδί LLM, οπότε καταλαβαίνω μόνο ερωτήσεις σαν τα
          παραδείγματα. Ορίστε <code>LLM_PROVIDER</code> και κλειδί API στο <code>.env</code> για
          οποιαδήποτε ερώτηση για τον στόλο.
        </p>
      )}

      {error && <div className="error-state" role="alert">{error}</div>}

      {exchanges.length === 0 ? (
        <div className="empty-state">
          <p className="label">Ερωτήσεις</p>
          <p>Δοκιμάστε ένα από τα παραδείγματα παραπάνω ή κάντε τη δική σας ερώτηση.</p>
        </div>
      ) : (
        <div className="ask-exchanges" aria-live="polite">
          {exchanges.map((ex) => (
            <div key={ex.id} className="ask-exchange">
              <p className="ask-exchange__question">{ex.question}</p>
              <p className="ask-exchange__answer">{ex.response.answer}</p>
              {ex.response.citations.length > 0 && (
                <div className="ask-exchange__citations">
                  {ex.response.citations.map((c) => (
                    <CitationChip key={`${c.table}:${c.id}`} citation={c} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
