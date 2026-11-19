import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { api, type AskResponse, type Citation, type RecordResponse } from "../lib/api.js";
import "./Ask.css";

const EXAMPLE_QUESTIONS = [
  "Πόσο καύσιμο έχουμε γλιτώσει από τις εγκεκριμένες συστάσεις;",
  "Ποιο είναι το ETA του MV Aegean Star;",
  "Ποια πλοία επηρεάζονται από καθυστερήσεις λιμανιών;",
  "Γιατί δεν πήραμε την προσφορά της Γένοβας;",
];

interface Exchange {
  id: number;
  question: string;
  response: AskResponse;
}

function CitationChip({ citation }: { citation: Citation }) {
  const [expanded, setExpanded] = useState(false);
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
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {citation.table} · {citation.id.slice(0, 8)}
      </button>
      {expanded && (
        <pre className="citation-chip__data">{loading ? "Φόρτωση…" : JSON.stringify(record?.data, null, 2)}</pre>
      )}
    </div>
  );
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getMeta()
      .then((m) => {
        if (!cancelled) setUsingMock(m.llmProvider === "mock");
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
