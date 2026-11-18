import { useState } from "react";
import { ChevronDown, ChevronUp, FileText, Anchor, Navigation } from "lucide-react";
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

const EVENT_TITLES: Record<string, string> = {
  BERTH_DELAY: "Just-in-Time Slow Steaming",
  CONGESTION: "Port Congestion Speed Adjustment",
  CLOSURE: "Port Closure Reroute / Hold",
  BUNKER_OFFER: "Bunker Procurement Evaluation",
  NONE: "Voyage Optimization",
};

function formatHumanFacts(table: string, data: Record<string, unknown>): Array<{ k: string; v: string }> {
  if (table === "email") {
    return [
      { k: "Sender", v: String(data.fromAddr ?? "-") },
      { k: "Subject", v: String(data.subject ?? "-") },
      {
        k: "Received",
        v: data.receivedAt ? new Date(String(data.receivedAt)).toLocaleString() : "-",
      },
    ];
  }
  if (table === "portEvent") {
    const rows: Array<{ k: string; v: string }> = [
      { k: "Event Type", v: String(data.eventType ?? "-") },
    ];
    if (data.delayHours != null) rows.push({ k: "Reported Delay", v: `+${data.delayHours} hours` });
    if (data.newBerthTime) {
      rows.push({ k: "New Berth Window", v: new Date(String(data.newBerthTime)).toLocaleString() });
    }
    if (data.fuelGrade) rows.push({ k: "Fuel Grade", v: String(data.fuelGrade) });
    if (data.priceUsdPerT != null) rows.push({ k: "Quoted Price", v: `$${data.priceUsdPerT} / t` });
    if (data.qtyMinT != null) rows.push({ k: "Min Quantity", v: `${data.qtyMinT} t` });
    return rows;
  }
  if (table === "voyage") {
    return [
      { k: "Voyage Status", v: String(data.status ?? "-") },
      { k: "Planned Speed", v: data.speedKn != null ? `${Number(data.speedKn).toFixed(1)} kn` : "-" },
      {
        k: "Planned ETA",
        v: data.plannedEta ? new Date(String(data.plannedEta)).toLocaleString() : "-",
      },
    ];
  }
  return Object.entries(data)
    .filter(([k]) => !k.endsWith("Id") && k !== "id")
    .slice(0, 5)
    .map(([k, v]) => ({ k, v: String(v ?? "-") }));
}

function FactRow({
  table,
  id,
  label,
  icon,
}: {
  table: string;
  id: string;
  label: string;
  icon: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
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

  const humanRows = record?.data ? formatHumanFacts(table, record.data as Record<string, unknown>) : [];

  return (
    <div className="fact-row">
      <button className="fact-row__toggle" onClick={toggle} aria-expanded={expanded}>
        {icon}
        <span>{label}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded && (
        <div className="fact-card">
          {loading ? (
            <span>Loading record...</span>
          ) : (
            <>
              <div className="fact-kv-list">
                {humanRows.map((item) => (
                  <div key={item.k} className="fact-kv-row">
                    <span className="fact-kv-key">{item.k}</span>
                    <span className="fact-kv-val">{item.v}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="fact-raw-toggle"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? "Hide raw JSON" : "View raw JSON"}
              </button>
              {showRaw && (
                <pre className="fact-row__data">{JSON.stringify(record?.data, null, 2)}</pre>
              )}
            </>
          )}
        </div>
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
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vessel = recommendation.voyage?.vessel;
  const port = recommendation.portEvent?.port;
  const eventType = recommendation.portEvent?.eventType ?? "NONE";
  const delayHours = recommendation.portEvent?.delayHours;

  const baseTitle = EVENT_TITLES[eventType] ?? eventType;
  const trigger =
    port && delayHours != null
      ? `${baseTitle} - ${port.name} (+${delayHours}h)`
      : port
      ? `${baseTitle} - ${port.name}`
      : baseTitle;

  const bunker =
    recommendation.actionType === "BUNKER_DETOUR" ? (recommendation.calc as unknown as BunkerCalc) : null;
  const notWorthIt = bunker?.verdict === "NOT_WORTH_IT" || recommendation.costSavedEur < 0;
  const notWorthItBecause =
    bunker && bunker.verdict === "NOT_WORTH_IT"
      ? bunkerVerdictReason(bunker, recommendation.voyage?.destPort?.name ?? "destination")
      : null;

  const fuelDelta = recommendation.fuelSavedT;
  const co2Delta = recommendation.co2SavedT;
  const costDelta = recommendation.costSavedEur;

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
    <div
      className={
        notWorthIt
          ? "recommendation-card recommendation-card--not-worth-it"
          : "recommendation-card recommendation-card--worth-it"
      }
    >
      <div className={notWorthIt ? "verdict verdict--no" : "verdict verdict--yes"}>
        <div>
          <strong>{notWorthIt ? "Not worth it" : "Recommended Action"}</strong>
          {notWorthItBecause ? (
            <span>: {notWorthItBecause}.</span>
          ) : (
            <span>
              : Net operational gain of €{Math.round(costDelta).toLocaleString("en-US")} verified against ETA window.
            </span>
          )}
        </div>
        <span className={notWorthIt ? "verdict-pill verdict-pill--no" : "verdict-pill verdict-pill--yes"}>
          {notWorthIt ? "AI: Suggest Reject" : "AI: Suggest Approve"}
        </span>
      </div>

      <div className="recommendation-card__header">
        <div>
          <p className="label">{vessel?.name ?? "Vessel"}</p>
          <p className="recommendation-card__trigger">{trigger}</p>
          {recommendation.voyage?.originPort && recommendation.voyage?.destPort && (
            <p className="recommendation-card__route-sub">
              Active Voyage: {recommendation.voyage.originPort.name} &rarr; {recommendation.voyage.destPort.name}
            </p>
          )}
        </div>
        <div className="recommendation-card__speed">
          <span>{recommendation.currentSpeedKn.toFixed(1)} kn</span>
          <span className="recommendation-card__arrow">&rarr;</span>
          <span className="recommendation-card__speed--new">
            {recommendation.recommendedSpeedKn.toFixed(1)} kn
          </span>
        </div>
      </div>

      <div className="recommendation-card__kpis">
        <div className="kpi-tile">
          <p className="label">{fuelDelta >= 0 ? "Fuel Saved" : "Extra Fuel Burn"}</p>
          <p className={`kpi ${fuelDelta >= 0 ? "kpi--positive" : "kpi--negative"}`}>
            {fuelDelta >= 0 ? `${fuelDelta.toFixed(1)} t` : `+${Math.abs(fuelDelta).toFixed(1)} t`}
          </p>
          <p className="kpi-tile__assumption">
            {fuelDelta >= 0 ? "Propeller cubic law reduction" : "Required for schedule / detour"}
          </p>
        </div>

        <div className="kpi-tile">
          <p className="label">{costDelta >= 0 ? "Net Cost Saved" : "Net Cost Impact"}</p>
          <p className={`kpi ${costDelta >= 0 ? "kpi--positive" : "kpi--negative"}`}>
            {costDelta >= 0
              ? `€${Math.round(costDelta).toLocaleString("en-US")}`
              : `-€${Math.abs(Math.round(costDelta)).toLocaleString("en-US")}`}
          </p>
          <p className="kpi-tile__assumption">ref bunker: €{fuelPriceEurPerT}/t</p>
        </div>

        <div className="kpi-tile">
          <p className="label">{co2Delta >= 0 ? "CO2 Emissions Saved" : "Extra CO2 Emissions"}</p>
          <p className={`kpi ${co2Delta >= 0 ? "kpi--positive" : "kpi--negative"}`}>
            {co2Delta >= 0 ? `${co2Delta.toFixed(1)} t` : `+${Math.abs(co2Delta).toFixed(1)} t`}
          </p>
          <p className="kpi-tile__assumption">
            EU ETS value: €{Math.round(Math.abs(co2Delta) * 75).toLocaleString("en-US")}
          </p>
        </div>
      </div>

      <p className="recommendation-card__rationale">{recommendation.rationale}</p>

      <div className="recommendation-card__facts">
        <p className="label">Audit Trail & Facts Used</p>
        <div className="facts-grid">
          {recommendation.portEvent?.email && (
            <FactRow
              table="email"
              id={recommendation.portEvent.email.id}
              label="Source Email"
              icon={<FileText size={14} />}
            />
          )}
          {recommendation.portEvent && (
            <FactRow
              table="portEvent"
              id={recommendation.portEvent.id}
              label="Parsed Port Event"
              icon={<Anchor size={14} />}
            />
          )}
          {recommendation.voyage && (
            <FactRow
              table="voyage"
              id={recommendation.voyage.id}
              label="Active Voyage"
              icon={<Navigation size={14} />}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="error-state" role="alert">
          {error}
        </div>
      )}

      {recommendation.status === "PENDING" ? (
        <div className="recommendation-card__actions">
          <button
            className={notWorthIt ? "btn" : "btn btn-primary"}
            onClick={handleApprove}
            disabled={busy}
          >
            Approve & Execute
          </button>
          <button
            className={notWorthIt ? "btn btn-primary" : "btn"}
            onClick={() => setShowRejectModal(true)}
            disabled={busy}
          >
            Reject Recommendation
          </button>
        </div>
      ) : (
        <div className="recommendation-card__decision">
          <p className="label">
            {recommendation.status} &middot;{" "}
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
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`reject-title-${recommendation.id}`}
          >
            <p className="label" id={`reject-title-${recommendation.id}`}>
              Reject recommendation
            </p>
            <textarea
              aria-label="Reason for rejecting"
              autoFocus
              placeholder="e.g. Offer expires before arrival window..."
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
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}