import { useEffect, useMemo, useState } from "react";
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

  const approvedTotals = useMemo(() => {
    const approved = history.filter((r) => r.status === "APPROVED");
    return approved.reduce(
      (acc, r) => ({
        count: acc.count + 1,
        fuel: acc.fuel + r.fuelSavedT,
        cost: acc.cost + r.costSavedEur,
        co2: acc.co2 + r.co2SavedT,
      }),
      { count: 0, fuel: 0, cost: 0, co2: 0 }
    );
  }, [history]);

  const handleApprove = async (id: string) => {
    await api.approveRecommendation(id);
    await refresh();
  };

  const handleUndo = async (id: string) => {
    await api.undoApproval(id);
    await refresh();
  };

  const handleReject = async (id: string, reason: string) => {
    await api.rejectRecommendation(id, reason);
    await refresh();
  };

  const visible = tab === "pending" ? pending : history;

  return (
    <div className="page page--actions">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div className="actions-tabs" role="tablist" aria-label="Recommendations" style={{ marginBottom: 0 }}>
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
            History{history.length > 0 ? ` (${history.length})` : ""}
          </button>
        </div>

{approvedTotals.count > 0 && (
          <div
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 999,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              color: "#166534",
              fontWeight: 600,
            }}
          >
            Approved Impact:{" "}
            {approvedTotals.fuel >= 0
              ? `${approvedTotals.fuel.toFixed(1)}t fuel saved`
              : `+${Math.abs(approvedTotals.fuel).toFixed(1)}t extra burn`}{" "}
            &middot; €{Math.round(approvedTotals.cost).toLocaleString("en-US")} net &middot;{" "}
            {approvedTotals.co2 >= 0
              ? `${approvedTotals.co2.toFixed(1)}t CO2 saved`
              : `+${Math.abs(approvedTotals.co2).toFixed(1)}t CO2`}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-state" role="status">
          Loading actions...
        </div>
      ) : error ? (
        <div className="error-state" role="alert">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {tab === "pending"
            ? "No pending recommendations. Process a delay or bunker email in the Inbox to generate one."
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
            onUndo={handleUndo}
          />
        ))
      )}
    </div>
  );
}