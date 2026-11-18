import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api, type RecommendationRecord, type RecordResponse } from "../lib/api.js";
import {
  bunkerCalc,
  eurFull,
  eurShort,
  headline,
  isBunker,
  jitCalc,
  triggerText,
} from "../lib/recommendationText.js";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: RecommendationRecord;
  fuelPriceEurPerT: number;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
}

type CalcRow = { key: string; label: string; unit?: string; digits?: number };

const CALC_ROWS: CalcRow[] = [
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

const BUNKER_ROWS: CalcRow[] = [
  { key: "remainingNm", label: "Remaining distance on route", unit: "nm" },
  { key: "alongNm", label: "Distance to the turn-off point", unit: "nm" },
  { key: "offRouteNm", label: "Bunker port off the route", unit: "nm" },
  { key: "detourNm", label: "Detour (out and back)", unit: "nm", digits: 1 },
  { key: "hoursToDeadline", label: "Hours until the berth", unit: "h" },
  { key: "portHours", label: "Time alongside for bunkering", unit: "h", digits: 0 },
  { key: "v0", label: "Current speed", unit: "kn" },
  { key: "requiredSpeedKn", label: "Speed needed to still make the berth", unit: "kn" },
  { key: "speedBunkerKn", label: "Speed with the detour", unit: "kn" },
  { key: "fuelStayT", label: "Fuel burned: stay on route", unit: "t" },
  { key: "fuelBunkerT", label: "Fuel burned: with bunker call", unit: "t" },
  { key: "extraFuelT", label: "Extra fuel for the detour", unit: "t" },
  { key: "priceUsdPerT", label: "Offer price", unit: "$/t", digits: 0 },
  { key: "usdEurRate", label: "USD → EUR rate", unit: "", digits: 4 },
  { key: "offerPriceEurPerT", label: "Offer price in euros", unit: "€/t", digits: 0 },
  { key: "refPriceEurPerT", label: "Our reference fuel price", unit: "€/t", digits: 0 },
  { key: "qtyT", label: "Quantity", unit: "t", digits: 0 },
  { key: "priceSavingEur", label: "Saving on the fuel price", unit: "€" },
  { key: "extraFuelCostEur", label: "Cost of the extra fuel", unit: "€" },
  { key: "portFeeEur", label: "Port and agency costs", unit: "€" },
  { key: "netEur", label: "Net result", unit: "€" },
];

function formatCell(value: number, unit?: string, digits?: number): string {
  if (unit === "€") return eurFull(value);
  return `${value.toFixed(digits ?? 2)} ${unit ?? ""}`.trim();
}

function MathRows({ calc, rows }: { calc: object; rows: CalcRow[] }) {
  const values = calc as Record<string, unknown>;
  return (
    <dl className="math-table">
      {rows.map((row) => {
        const value = values[row.key];
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        return (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>{formatCell(value, row.unit, row.digits)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Two-row "what we do now vs what we recommend" table at the top of the math. */
function PlanTable({ recommendation }: { recommendation: RecommendationRecord }) {
  if (isBunker(recommendation)) {
    const c = bunkerCalc(recommendation);
    const port = recommendation.portEvent?.port?.name ?? "bunker port";
    return (
      <table className="plan-table">
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Speed</th>
            <th scope="col">Extra sailing</th>
            <th scope="col">Wait at anchor</th>
            <th scope="col">Fuel burned</th>
            <th scope="col">Fuel price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Stay on route</th>
            <td>{c.v0.toFixed(1)} kn</td>
            <td>—</td>
            <td>{c.waitHoursStay.toFixed(0)} h</td>
            <td>{c.fuelStayT.toFixed(1)} t</td>
            <td>€{Math.round(c.refPriceEurPerT)}/t</td>
          </tr>
          <tr>
            <th scope="row">Bunker at {port}</th>
            <td>{c.speedBunkerKn.toFixed(1)} kn</td>
            <td>{c.detourNm.toFixed(0)} nm + {c.portHours.toFixed(0)} h alongside</td>
            <td>{c.waitHoursBunker.toFixed(0)} h</td>
            <td>{c.fuelBunkerT.toFixed(1)} t</td>
            <td>€{Math.round(c.offerPriceEurPerT)}/t</td>
          </tr>
        </tbody>
      </table>
    );
  }
  const c = jitCalc(recommendation);
  return (
    <table className="plan-table">
      <thead>
        <tr>
          <th scope="col">Plan</th>
          <th scope="col">Speed</th>
          <th scope="col">Wait at anchor</th>
          <th scope="col">Fuel burned</th>
          <th scope="col">Fuel cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">A · Rush and wait</th>
          <td>{c.v0.toFixed(1)} kn</td>
          <td>{c.waitHoursPlanA.toFixed(0)} h</td>
          <td>{c.fuelA.toFixed(1)} t</td>
          <td>{eurFull(c.fuelA * c.fuelPriceEurPerT)}</td>
        </tr>
        <tr>
          <th scope="row">B · Arrive on time</th>
          <td>{c.v1.toFixed(1)} kn</td>
          <td>{c.residualWaitHoursPlanB.toFixed(0)} h</td>
          <td>{c.fuelB.toFixed(1)} t</td>
          <td>{eurFull(c.fuelB * c.fuelPriceEurPerT)}</td>
        </tr>
      </tbody>
    </table>
  );
}

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

  const [showFullRationale, setShowFullRationale] = useState(false);

  const bunker = isBunker(recommendation);
  const vessel = recommendation.voyage?.vessel;
  const h = headline(recommendation);
  const trigger = triggerText(recommendation);
  const worthIt = bunker ? bunkerCalc(recommendation).verdict === "WORTH_IT" : true;
  const autoDeclined = bunker && !worthIt;

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
    <div className={autoDeclined ? "recommendation-card recommendation-card--declined" : "recommendation-card"}>
      <div className="recommendation-card__header">
        <p className="label">
          {vessel?.name ?? "Vessel"}
          {trigger && <span className="recommendation-card__trigger"> · {trigger}</span>}
        </p>
        {bunker && (
          <span className={worthIt ? "verdict-pill verdict-pill--yes" : "verdict-pill verdict-pill--no"}>
            {worthIt ? "Worth it" : "Not worth it"}
          </span>
        )}
      </div>

      <p className="recommendation-card__kicker">{h.kicker}</p>
      <p className="recommendation-card__headline">
        <strong>{h.lead}</strong> {h.body} <strong>{h.money}</strong>
      </p>

      <div className="recommendation-card__kpis">
        <div className="kpi-tile kpi-tile--hero">
          <p className="label">{bunker ? "Net result" : "Cost saved"}</p>
          <p className={recommendation.costSavedEur < 0 ? "kpi kpi--negative" : "kpi"}>
            {eurShort(recommendation.costSavedEur, bunker)}
          </p>
        </div>
        {bunker ? (
          <div className="recommendation-card__small-kpis">
            <div className="kpi-tile">
              <p className="label">Extra time</p>
              <p className="kpi kpi--small">+{bunkerCalc(recommendation).extraHours.toFixed(0)} h</p>
            </div>
            <div className="kpi-tile">
              <p className="label">Detour</p>
              <p className="kpi kpi--small">{bunkerCalc(recommendation).detourNm.toFixed(0)} nm</p>
            </div>
          </div>
        ) : (
          <div className="recommendation-card__small-kpis">
            <div className="kpi-tile">
              <p className="label">Fuel saved</p>
              <p className="kpi kpi--small">{recommendation.fuelSavedT.toFixed(1)} t</p>
            </div>
            <div className="kpi-tile">
              <p className="label">CO₂ saved</p>
              <p className="kpi kpi--small">{recommendation.co2SavedT.toFixed(1)} t</p>
            </div>
          </div>
        )}
      </div>

      <p
        className={
          showFullRationale
            ? "recommendation-card__rationale"
            : "recommendation-card__rationale recommendation-card__rationale--clamped"
        }
      >
        {recommendation.rationale}
      </p>
      <button
        className="recommendation-card__more"
        onClick={() => setShowFullRationale((v) => !v)}
        aria-expanded={showFullRationale}
      >
        {showFullRationale ? "Less" : "More"}
      </button>

      <button
        className="recommendation-card__toggle"
        onClick={() => setShowMath((v) => !v)}
        aria-expanded={showMath}
      >
        {showMath ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Show the math
      </button>

      {showMath && (
        <div className="recommendation-card__math">
          <PlanTable recommendation={recommendation} />
          <MathRows calc={recommendation.calc} rows={bunker ? BUNKER_ROWS : CALC_ROWS} />
          <p className="recommendation-card__assumption">
            {bunker
              ? `Assumptions: our fuel costs €${bunkerCalc(recommendation).refPriceEurPerT}/t; $1 = €${bunkerCalc(recommendation).usdEurRate}; ${bunkerCalc(recommendation).portHours} h alongside and ${eurFull(bunkerCalc(recommendation).portFeeEur)} port costs.${bunkerCalc(recommendation).qtyAssumed ? " The offer gave no quantity, so the default from Settings is used." : ""}`
              : `Assumption: fuel at €${fuelPriceEurPerT}/t.`}
          </p>
        </div>
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

      {autoDeclined ? (
        <div className="recommendation-card__decision">
          <p className="label">
            Declined automatically ·{" "}
            {recommendation.decidedAt && new Date(recommendation.decidedAt).toLocaleString()}
          </p>
        </div>
      ) : recommendation.status === "PENDING" ? (
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
