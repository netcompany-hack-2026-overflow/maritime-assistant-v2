import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { bunkerVerdictReason, type BunkerCalc } from "@maritime/shared";
import { api, type RecommendationRecord, type RecordResponse } from "../lib/api.js";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: RecommendationRecord;
  fuelPriceEurPerT: number;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
}

const EVENT_LABELS: Record<string, string> = {
  BERTH_DELAY: "berth delay",
  CONGESTION: "congestion",
  CLOSURE: "closure",
  BUNKER_OFFER: "fuel offer",
  NONE: "event",
};

const CALC_ROWS: Array<{ key: string; label: string; unit?: string; digits?: number }> = [
  { key: "distanceNm", label: "Remaining distance", unit: "nm" },
  { key: "hoursAvailable", label: "Hours available until berth", unit: "h" },
  { key: "headCurrentKn", label: "Head current (mock weather, + = adverse)", unit: "kn", digits: 1 },
  { key: "seaStateFuelFactor", label: "Sea-state fuel factor (mock weather)", unit: "×" },
  { key: "v0", label: "Current speed (v₀)", unit: "kn" },
  { key: "v1Raw", label: "Computed JIT speed (unclamped)", unit: "kn" },
  { key: "v1", label: "Recommended speed (v₁)", unit: "kn" },
  { key: "fAtV0", label: "Daily fuel at v₀", unit: "t/day" },
  { key: "fAtV1", label: "Daily fuel at v₁", unit: "t/day" },
  { key: "waitHoursPlanA", label: "Wait at anchor (Plan A)", unit: "h" },
  { key: "fuelA", label: "Fuel burned — Plan A (rush & wait)", unit: "t" },
  { key: "residualWaitHoursPlanB", label: "Residual wait (Plan B)", unit: "h" },
  { key: "fuelB", label: "Fuel burned — Plan B (JIT)", unit: "t" },
  { key: "fuelSavedT", label: "Fuel saved", unit: "t" },
  { key: "costSavedEur", label: "Cost saved", unit: "€", digits: 0 },
  { key: "co2SavedT", label: "CO₂ saved", unit: "t" },
];

function FactRow({ table, id, label }: { table: string; id: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const [record, setRecord] = useState<RecordResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!expanded && !record) {
      setLoading(true);
      try {
        const r = await api.getRecord(table, id);
        setRecord(r);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="fact-row">
      <button className="fact-row__toggle" onClick={toggle} aria-expanded={expanded}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {label}
      </button>
      {expanded && (
        <pre className="fact-row__data">
          {loading ? "Loading…" : JSON.stringify(record?.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function RecommendationCard({
  recommendation,
  fuelPriceEurPerT,
  onApprove,
  onReject,
  onUndo,
}: RecommendationCardProps) {
  const [showMath, setShowMath] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vessel = recommendation.voyage?.vessel;
  const port = recommendation.portEvent?.port;
  const eventType = recommendation.portEvent?.eventType ?? "NONE";
  const delayHours = recommendation.portEvent?.delayHours;

  const trigger =
    port && delayHours != null
      ? `${port.name} ${EVENT_LABELS[eventType] ?? eventType} +${delayHours}h`
      : EVENT_LABELS[eventType] ?? eventType;

  // Fuel offers: flag the ones that don't pay off, so they stand out before anyone approves.
  const bunker =
    recommendation.actionType === "BUNKER_DETOUR" ? (recommendation.calc as unknown as BunkerCalc) : null;
  const notWorthIt = bunker?.verdict === "NOT_WORTH_IT";
  const notWorthItBecause =
    bunker && notWorthIt ? bunkerVerdictReason(bunker, recommendation.voyage?.destPort?.name ?? "destination") : null;

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApprove(recommendation.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    setBusy(true);
    setError(null);
    try {
      await onUndo(recommendation.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRejectSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReject(recommendation.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={notWorthIt ? "recommendation-card recommendation-card--not-worth-it" : "recommendation-card"}>
      {bunker && (
        <p className={notWorthIt ? "verdict verdict--no" : "verdict verdict--yes"}>
          <strong>{notWorthIt ? "Not worth it" : "Worth it"}</strong>
          {notWorthItBecause && <span>: {notWorthItBecause}.</span>}
        </p>
      )}
      <div className="recommendation-card__header">
        <div>
          <p className="label">{vessel?.name ?? "Vessel"}</p>
          <p className="recommendation-card__trigger">{trigger}</p>
        </div>
        <div className="recommendation-card__speed">
          <span>{recommendation.currentSpeedKn.toFixed(1)} kn</span>
          <span className="recommendation-card__arrow">→</span>
          <span className="recommendation-card__speed--new">
            {recommendation.recommendedSpeedKn.toFixed(1)} kn
          </span>
        </div>
      </div>

      <div className="recommendation-card__kpis">
        <div className="kpi-tile">
          <p className="label">Fuel saved</p>
          <p className="kpi">{recommendation.fuelSavedT.toFixed(1)} t</p>
        </div>
        <div className="kpi-tile">
          <p className="label">Cost saved</p>
          <p className="kpi">
            €{Math.round(recommendation.costSavedEur).toLocaleString("en-US")}
          </p>
          <p className="kpi-tile__assumption">assumption: €{fuelPriceEurPerT}/t fuel</p>
        </div>
        <div className="kpi-tile">
          <p className="label">CO₂ saved</p>
          <p className="kpi">{recommendation.co2SavedT.toFixed(1)} t</p>
        </div>
      </div>

      <p className="recommendation-card__rationale">{recommendation.rationale}</p>

      <button
        className="recommendation-card__toggle"
        onClick={() => setShowMath((v) => !v)}
        aria-expanded={showMath}
      >
        {showMath ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Show the math
      </button>

      {showMath && (
        <dl className="math-table">
          {CALC_ROWS.map((row) => {
            const value = recommendation.calc[row.key];
            if (value === undefined) return null;
            const num = typeof value === "number" ? value : Number(value);
            return (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>
                  {row.unit === "€"
                    ? `€${Math.round(num).toLocaleString("en-US")}`
                    : `${num.toFixed(row.digits ?? 2)} ${row.unit ?? ""}`}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      <div className="recommendation-card__facts">
        <p className="label">Facts used</p>
        {recommendation.portEvent?.email && (
          <FactRow table="email" id={recommendation.portEvent.email.id} label="Source email" />
        )}
        {recommendation.portEvent && (
          <FactRow table="portEvent" id={recommendation.portEvent.id} label="Port event" />
        )}
        {recommendation.voyage && (
          <FactRow table="voyage" id={recommendation.voyage.id} label="Voyage" />
        )}
      </div>

      {error && <div className="error-state" role="alert">{error}</div>}

      {recommendation.status === "PENDING" ? (
        <div className="recommendation-card__actions">
          <button className="btn btn-primary" onClick={handleApprove} disabled={busy}>
            Approve
          </button>
          <button className="btn" onClick={() => setShowRejectModal(true)} disabled={busy}>
            Reject
          </button>
        </div>
      ) : (
        <div className="recommendation-card__decision">
          <p className="label">
            {recommendation.status} ·{" "}
            {recommendation.decidedAt && new Date(recommendation.decidedAt).toLocaleString()}
          </p>
          {recommendation.rejectReason && <p>Reason: {recommendation.rejectReason}</p>}
          {recommendation.status === "APPROVED" && (
            <button className="btn recommendation-card__undo" onClick={handleUndo} disabled={busy}>
              Undo approval
            </button>
          )}
        </div>
      )}

      {showRejectModal && (
        <div
          className="modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setShowRejectModal(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`reject-title-${recommendation.id}`}>
            <p className="label" id={`reject-title-${recommendation.id}`}>
              Reject recommendation
            </p>
            <textarea
              aria-label="Reason for rejecting"
              autoFocus
              placeholder="Reason for rejecting…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowRejectModal(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRejectSubmit}
                disabled={busy || rejectReason.trim().length === 0}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
