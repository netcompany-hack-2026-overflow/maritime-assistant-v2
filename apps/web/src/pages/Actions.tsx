import { useEffect, useMemo, useState } from "react";
import type { ScenarioId } from "@maritime/shared";
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
  // Just-approved card: shown first in History so its notice draft is in view.
  const [focusId, setFocusId] = useState<string | null>(null);

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
  const openPerVoyage = new Map<string, number>();
  for (const r of pending) openPerVoyage.set(r.voyageId, (openPerVoyage.get(r.voyageId) ?? 0) + 1);
  const history = recommendations
    .filter((r) => r.status !== "PENDING")
    .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0));

  const handleApprove = async (id: string, scenarioId?: ScenarioId) => {
    await api.approveRecommendation(id, scenarioId);
    await refresh();
    setFocusId(id);
    setTab("history");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRefresh = async (id: string) => {
    await api.refreshRecommendation(id);
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

  // What the approved recommendations add up to (bunker calls count their extra fuel as negative).
  const approvedTotals = useMemo(
    () =>
      recommendations
        .filter((r) => r.status === "APPROVED")
        .reduce(
          (acc, r) => ({ count: acc.count + 1, fuel: acc.fuel + r.fuelSavedT, cost: acc.cost + r.costSavedEur, co2: acc.co2 + r.co2SavedT }),
          { count: 0, fuel: 0, cost: 0, co2: 0 }
        ),
    [recommendations]
  );

  return (
    <div className="page page--actions">
      <div className="actions-head">
      <div className="actions-tabs" role="tablist" aria-label="Συστάσεις">
        <button
          className={tab === "pending" ? "actions-tab actions-tab--active" : "actions-tab"}
          onClick={() => setTab("pending")}
          role="tab"
          aria-selected={tab === "pending"}
        >
          Σε αναμονή{pending.length > 0 ? ` (${pending.length})` : ""}
        </button>
        <button
          className={tab === "history" ? "actions-tab actions-tab--active" : "actions-tab"}
          onClick={() => setTab("history")}
          role="tab"
          aria-selected={tab === "history"}
        >
          Ιστορικό{history.length > 0 ? ` (${history.length})` : ""}
        </button>
      </div>
      {approvedTotals.count > 0 && (
        <p className="actions-impact">
          Από εγκεκριμένες:{" "}
          {approvedTotals.fuel >= 0
            ? `${approvedTotals.fuel.toFixed(1)} t καύσιμο λιγότερο`
            : `${Math.abs(approvedTotals.fuel).toFixed(1)} t επιπλέον καύσιμο`}{" "}
          · {approvedTotals.cost < 0 ? "−" : ""}€{Math.abs(Math.round(approvedTotals.cost)).toLocaleString("en-US")} καθαρό ·{" "}
          {approvedTotals.co2 >= 0
            ? `${approvedTotals.co2.toFixed(1)} t CO₂ λιγότερο`
            : `${Math.abs(approvedTotals.co2).toFixed(1)} t επιπλέον CO₂`}
        </p>
      )}
      </div>

      {loading ? (
        <div className="loading-state" role="status">Φόρτωση ενεργειών…</div>
      ) : error ? (
        <div className="error-state" role="alert">{error}</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {tab === "pending"
            ? "Δεν υπάρχουν συστάσεις σε αναμονή. Επεξεργαστείτε ένα email καθυστέρησης ή προσφοράς καυσίμου στα Εισερχόμενα για να δημιουργηθεί μία."
            : "Δεν υπάρχουν ακόμα αποφασισμένες συστάσεις."}
        </div>
      ) : (
        visible.map((rec) => (
          <RecommendationCard
            key={`${rec.id}:${rec.status}:${rec.scenarios?.generatedAt ?? ""}:${rec.outboundEmails?.length ?? 0}`}
            recommendation={rec}
            fuelPriceEurPerT={fuelPriceEurPerT}
            onApprove={handleApprove}
            onRefresh={handleRefresh}
            onReject={handleReject}
            onUndo={handleUndo}
            alternatives={rec.status === "PENDING" ? (openPerVoyage.get(rec.voyageId) ?? 1) - 1 : 0}
          />
        ))
      )}
    </div>
  );
}
