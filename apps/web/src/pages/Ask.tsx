
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Send, Sparkles } from "lucide-react";
import { api, type AskResponse, type Citation, type RecordResponse } from "../lib/api.js";
import "./Ask.css";

const EXAMPLE_QUESTIONS = [
  "How much fuel have we saved from approved recommendations?",
  "What's MV Aegean Star's ETA?",
  "Which vessels are affected by port delays?",
  "Which vessels have a poor CII rating and need slow steaming?",
];

interface Exchange {
  id: number;
  question: string;
  response: AskResponse;
}

function formatCitationFacts(table: string, data: Record<string, unknown>): Array<{ k: string; v: string }> {
  if (table === "recommendation" || table === "recommendations") {
    return [
      { k: "Action Type", v: String(data.actionType ?? "-") },
      { k: "Status", v: String(data.status ?? "-") },
      { k: "Fuel Impact", v: data.fuelSavedT != null ? `${Number(data.fuelSavedT).toFixed(1)} t` : "-" },
      { k: "Cost Impact", v: data.costSavedEur != null ? `€${Math.round(Number(data.costSavedEur)).toLocaleString()}` : "-" },
    ];
  }
  if (table === "voyage") {
    return [
      { k: "Status", v: String(data.status ?? "-") },
      { k: "Speed", v: data.speedKn != null ? `${Number(data.speedKn).toFixed(1)} kn` : "-" },
      { k: "Planned ETA", v: data.plannedEta ? new Date(String(data.plannedEta)).toLocaleString() : "-" },
    ];
  }
  return Object.entries(data)
    .filter(([k]) => !k.endsWith("Id") && k !== "id")
    .slice(0, 4)
    .map(([k, v]) => ({ k, v: String(v ?? "-") }));
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

  const humanRows = record?.data ? formatCitationFacts(citation.table, record.data as Record<string, unknown>) : [];

  return (
    <div className="citation-chip">
      <button className="citation-chip__toggle" onClick={toggle} aria-expanded={expanded}>
        <span>
          {citation.table} &middot; {citation.id.slice(0, 8)}
        </span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="citation-card">
          {loading ? (
            <span>Loading record...</span>
          ) : (
            <>
              <div className="citation-kv-list">
                {humanRows.map((item) => (
                  <div key={item.k} className="citation-kv-row">
                    <span className="citation-kv-key">{item.k}</span>
                    <span className="citation-kv-val">{item.v}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="citation-raw-toggle"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? "Hide raw JSON" : "View raw JSON"}
              </button>
              {showRaw && (
                <pre className="citation-chip__data">
                  {JSON.stringify(record?.data, null, 2)}
                </pre>
              )}
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

  useEffect(() => {
    // Background check to keep API hook active without showing ugly warnings
    api.getMeta().catch(() => {});
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
      <div className="ask-notice" role="note">
        <Sparkles size={16} />
        <span>Tidewise Maritime Copilot Active — Powered by Semantic Fleet Intent Index</span>
      </div>

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
          placeholder="Ask a question about the fleet (e.g. fuel savings, ETAs, delays)..."
          aria-label="Question about the fleet"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          <Send size={14} />
          Ask AI
        </button>
      </form>

      <div className="ask-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} className="ask-example" onClick={() => void ask(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </div>

      {error && <div className="error-state" role="alert">{error}</div>}

      {exchanges.length === 0 ? (
        <div className="empty-state">
          <p className="label">Fleet Copilot</p>
          <p>Try one of the example questions above, or type your own operational query.</p>
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