import { useState } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { api, type AskResponse, type Citation, type RecordResponse } from "../lib/api.js";
import "./Ask.css";

const EXAMPLE_QUESTIONS = [
  "How much fuel have we saved from approved recommendations?",
  "What's MV Aegean Star's ETA?",
  "Which vessels are affected by port delays?",
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
      <button className="citation-chip__toggle" onClick={toggle}>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {citation.table} · {citation.id.slice(0, 8)}
      </button>
      {expanded && (
        <pre className="citation-chip__data">{loading ? "Loading…" : JSON.stringify(record?.data, null, 2)}</pre>
      )}
    </div>
  );
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          placeholder="Ask a question about the fleet…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          <Send size={14} />
          Ask
        </button>
      </form>

      <div className="ask-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} className="ask-example" onClick={() => void ask(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>

      {error && <div className="error-state">{error}</div>}

      {exchanges.length === 0 ? (
        <div className="empty-state">
          <p className="label">Ask</p>
          <p>Try one of the example questions above, or ask your own.</p>
        </div>
      ) : (
        <div className="ask-exchanges">
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
