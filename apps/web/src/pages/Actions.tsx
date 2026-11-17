import { useEffect, useState } from "react";
import { api, type RecommendationRecord } from "../lib/api.js";
import { RecommendationCard } from "../components/RecommendationCard.js";
import "./Actions.css";

type Tab = "pending" | "history";

export function Actions() {
  const [tab, setTab] = useState<Tab>("pending");
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [fuelPriceEurPerT, setFuelPriceEurPerT] = useState(600);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    return Promise.all([api.getRecommendations(), api.getMeta()])
      .then(([recs, meta]) => {
        setRecommendations(recs);
        setFuelPriceEurPerT(meta.fuelPriceEurPerT);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const pending = recommendations.filter((r) => r.status === "PENDING");
  const history = recommendations.filter((r) => r.status !== "PENDING");

  const handleApprove = async (id: string) => {
    await api.approveRecommendation(id);
    await refresh();
  };

  const handleReject = async (id: string, reason: string) => {
    await api.rejectRecommendation(id, reason);
    await refresh();
  };

  const visible = tab === "pending" ? pending : history;

  return (
    <div className="page page--actions">
      <div className="actions-tabs" role="tablist" aria-label="Recommendations">
        <button
          className={tab === "pending" ? "actions-tab actions-tab--active" : "actions-tab"}
          onClick={() => setTab("pending")}
          role="tab"
          aria-selected={tab === "pending"}
        >
          Pending{pending.length > 0 ? ` (${pending.length})` : ""}
        </button>
        <button
          className={tab === "history" ? "actions-tab actions-tab--active" : "actions-tab"}
          onClick={() => setTab("history")}
          role="tab"
          aria-selected={tab === "history"}
        >
          History
        </button>
      </div>

      {loading ? (
        <div className="loading-state" role="status">Loading actions…</div>
      ) : error ? (
        <div className="error-state" role="alert">{error}</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {tab === "pending"
            ? "No pending recommendations. Process a delay email in the Inbox to generate one."
            : "No decided recommendations yet."}
        </div>
      ) : (
        visible.map((rec) => (
          <RecommendationCard
            key={rec.id}
            recommendation={rec}
            fuelPriceEurPerT={fuelPriceEurPerT}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))
      )}
    </div>
  );
}
