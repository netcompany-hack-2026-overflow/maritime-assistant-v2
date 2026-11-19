import { useState } from "react";
import { ChevronDown, ChevronUp, FileText, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { bunkerVerdictReason, savingsVsBaseline, type BunkerCalc, type ScenarioId } from "@maritime/shared";
import { api, type OutboundEmail, type RecommendationRecord, type RecordResponse } from "../lib/api.js";
import { eur, money } from "../lib/format.js";
import { STATUS_LABEL } from "../lib/labels.js";
import { ScenarioComparison } from "./ScenarioComparison.js";
import { NoticePanel } from "./NoticePanel.js";
import "./RecommendationCard.css";

interface RecommendationCardProps {
  recommendation: RecommendationRecord;
  fuelPriceEurPerT: number;
  onApprove: (id: string, scenarioId?: ScenarioId) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
  /** Other open options for the same ship; approving this one closes them. */
  alternatives?: number;
}

const EVENT_LABELS: Record<string, string> = {
  BERTH_DELAY: "καθυστέρηση πρόσδεσης",
  CONGESTION: "συμφόρηση",
  CLOSURE: "κλείσιμο λιμανιού",
  BUNKER_OFFER: "προσφορά καυσίμου",
  NONE: "συμβάν",
};

const CALC_ROWS: Array<{ key: string; label: string; unit?: string; digits?: number }> = [
  { key: "distanceNm", label: "Υπόλοιπη απόσταση", unit: "nm" },
  { key: "hoursAvailable", label: "Ώρες ως την πρόσδεση", unit: "h" },
  { key: "headCurrentKn", label: "Ρεύμα κατά μήκος της διαδρομής (+ = αντίθετο)", unit: "kn", digits: 1 },
  { key: "seaStateFuelFactor", label: "Συντελεστής καυσίμου κατάστασης θάλασσας (κύμα)", unit: "×" },
  { key: "v0", label: "Τρέχουσα ταχύτητα (v₀)", unit: "kn" },
  { key: "v1Raw", label: "Υπολογισμένη ταχύτητα JIT (χωρίς όρια)", unit: "kn" },
  { key: "v1", label: "Προτεινόμενη ταχύτητα (v₁)", unit: "kn" },
  { key: "fAtV0", label: "Ημερήσιο καύσιμο στα v₀", unit: "t/ημέρα" },
  { key: "fAtV1", label: "Ημερήσιο καύσιμο στα v₁", unit: "t/ημέρα" },
  { key: "waitHoursPlanA", label: "Αναμονή στην άγκυρα (Σχέδιο A)", unit: "h" },
  { key: "fuelA", label: "Καύσιμο — Σχέδιο A (βιασύνη και αναμονή)", unit: "t" },
  { key: "residualWaitHoursPlanB", label: "Υπόλοιπη αναμονή (Σχέδιο B)", unit: "h" },
  { key: "fuelB", label: "Καύσιμο — Σχέδιο B (JIT)", unit: "t" },
  { key: "fuelSavedT", label: "Καύσιμο που γλιτώνεται", unit: "t" },
  { key: "costSavedEur", label: "Εξοικονόμηση κόστους", unit: "€", digits: 0 },
  { key: "co2SavedT", label: "CO₂ που γλιτώνεται", unit: "t" },
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
          {loading ? "Φόρτωση…" : JSON.stringify(record?.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CharterPartySummary({ recommendation }: { recommendation: RecommendationRecord }) {
  const [open, setOpen] = useState(false);
  const cp = recommendation.voyage?.charterParty;
  if (!cp) {
    return (
      <div className="cp-summary cp-summary--missing">
        <FileText size={14} aria-hidden="true" />
        <span>
          Δεν υπάρχει ναυλοσύμφωνο, οπότε laytime, demurrage και ρήτρα JIT δεν ελέγχονται.{" "}
          <Link to="/voyages">Ανεβάστε το στα Ταξίδια</Link>.
        </span>
      </div>
    );
  }
  const t = cp.terms;
  const facts = [
    t.laytimeHours != null && `Laytime ${t.laytimeHours} h${t.laytimeBasis ? ` ${t.laytimeBasis}` : ""}`,
    t.norNoticeHours != null && `NOR +${t.norNoticeHours} h`,
    t.waitingTimeCounts === true ? "η αναμονή μετράει (WIBON)" : t.waitingTimeCounts === false ? "η αναμονή δεν μετράει" : null,
    t.demurrageRatePerDay != null && `demurrage ${money(t.demurrageRatePerDay, t.currency)}/ημέρα`,
    cp.expectedOpsHours != null && `φορτοεκφόρτωση ${cp.expectedOpsHours} h (εκτίμηση)`,
  ].filter(Boolean);
  return (
    <div className="cp-summary">
      <FileText size={14} aria-hidden="true" />
      <div>
        <p>
          <strong>{t.reference ?? cp.sourceName}</strong>
          {t.chartererName && <> · {t.chartererName}</>}
        </p>
        <p className="cp-summary__facts">{facts.join(" · ")}</p>
        {t.jitClause.present ? (
          <button className="recommendation-card__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {t.jitClause.name ?? "Ρήτρα JIT"}
          </button>
        ) : (
          <p className="cp-summary__nojit">Χωρίς ρήτρα άφιξης just-in-time: ισχύει το utmost despatch.</p>
        )}
        {open && t.jitClause.text && <blockquote className="cp-summary__clause">{t.jitClause.text}</blockquote>}
      </div>
    </div>
  );
}

export function RecommendationCard({
  recommendation,
  fuelPriceEurPerT,
  onApprove,
  onRefresh,
  onReject,
  onUndo,
  alternatives = 0,
}: RecommendationCardProps) {
  const set = recommendation.scenarios;
  const [selected, setSelected] = useState<ScenarioId | null>(
    recommendation.chosenScenario ?? set?.recommendedId ?? null
  );
  const [notices, setNotices] = useState<OutboundEmail[]>(recommendation.outboundEmails ?? []);
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
    bunker && notWorthIt ? bunkerVerdictReason(bunker, recommendation.voyage?.destPort?.name ?? "προορισμό") : null;
  const isPending = recommendation.status === "PENDING";
  const shown = isPending ? selected : recommendation.chosenScenario ?? selected;
  const scenario = set?.scenarios.find((s) => s.id === shown) ?? null;
  const delta = set && shown ? savingsVsBaseline(set, shown) : null;
  const currency = scenario?.contract.laytime?.currency ?? recommendation.voyage?.charterParty?.terms.currency ?? "USD";

  const handleRefresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRefresh(recommendation.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApprove(recommendation.id, selected ?? undefined);
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
          <strong>{notWorthIt ? "Δεν αξίζει" : "Αξίζει"}</strong>
          {notWorthItBecause && <span>: {notWorthItBecause}.</span>}
        </p>
      )}
      <div className="recommendation-card__header">
        <div>
          <p className="label">{vessel?.name ?? "Πλοίο"}</p>
          <p className="recommendation-card__trigger">{trigger}</p>
        </div>
        <div className="recommendation-card__speed">
          <span>{recommendation.currentSpeedKn.toFixed(1)} kn</span>
          <span className="recommendation-card__arrow">→</span>
          <span className="recommendation-card__speed--new">
            {(scenario?.speedKn ?? recommendation.recommendedSpeedKn).toFixed(1)} kn
          </span>
          {shown && <span className="recommendation-card__scenario">σενάριο {shown}</span>}
        </div>
      </div>

      {set ? (
        <>
      <div className="recommendation-card__kpis">
        <div className="kpi-tile">
          <p className="label">Καύσιμο που γλιτώνεται</p>
          <p className="kpi">{(delta?.fuelT ?? recommendation.fuelSavedT).toFixed(1)} t</p>
          <p className="kpi-tile__assumption">CO₂ −{(delta?.co2T ?? recommendation.co2SavedT).toFixed(1)} t</p>
        </div>
        <div className="kpi-tile">
          <p className="label">Εξοικονόμηση κόστους</p>
          <p className="kpi">{eur(delta ? delta.totalCostEur : recommendation.costSavedEur)}</p>
          <p className="kpi-tile__assumption">
            {delta
              ? `καύσιμο ${eur(delta.fuelCostEur)} + EU ETS ${eur(delta.etsCostEur)}`
              : `παραδοχή: €${fuelPriceEurPerT}/t καύσιμο`}
          </p>
        </div>
        <div className="kpi-tile">
          <p className="label">Demurrage που αποφεύγεται</p>
          <p className="kpi">{delta?.demurrageAvoided != null ? money(delta.demurrageAvoided, currency) : "—"}</p>
          <p className="kpi-tile__assumption">
            {scenario?.contract.laytime
              ? scenario.contract.laytime.withinLaytime
                ? "εντός laytime"
                : `υπέρβαση laytime κατά ${scenario.contract.laytime.demurrageHours.toFixed(0)} h`
              : "χρειάζεται ναυλοσύμφωνο"}
          </p>
        </div>
        <div className="kpi-tile">
          <p className="label">CII (από αρχή έτους)</p>
          <p className="kpi">
            {scenario?.cii.annual ? scenario.cii.annual.rating : "—"}
          </p>
          <p className="kpi-tile__assumption">
            {scenario?.cii.annual && set
              ? `λόγος ${set.scenarios[0].cii.annual!.ratio.toFixed(3)} → ${scenario.cii.annual.ratio.toFixed(3)}`
              : ""}
          </p>
        </div>
      </div>
          <CharterPartySummary recommendation={recommendation} />
        </>
      ) : (
      <div className="recommendation-card__kpis recommendation-card__kpis--three">
        <div className="kpi-tile">
          <p className="label">Καύσιμο που γλιτώνεται</p>
          <p className="kpi">{recommendation.fuelSavedT.toFixed(1)} t</p>
        </div>
        <div className="kpi-tile">
          <p className="label">Εξοικονόμηση κόστους</p>
          <p className="kpi">{eur(recommendation.costSavedEur)}</p>
          <p className="kpi-tile__assumption">παραδοχή: €{fuelPriceEurPerT}/t καύσιμο</p>
        </div>
        <div className="kpi-tile">
          <p className="label">CO₂ που γλιτώνεται</p>
          <p className="kpi">{recommendation.co2SavedT.toFixed(1)} t</p>
        </div>
      </div>
      )}


      <p className="recommendation-card__rationale">{recommendation.rationale}</p>
      {bunker && (
        <Link className="recommendation-card__toggle" to={`/bunkering?offer=${recommendation.id}`}>
          Σύγκριση προσφορών, επιλογές διαδρομής και απαντήσεις →
        </Link>
      )}

      {set ? (
        <ScenarioComparison set={set} selected={shown} onSelect={isPending ? setSelected : null} />
      ) : bunker ? null : (
        <p className="muted">Η σύσταση αυτή είναι παλαιότερη από τη σύγκριση σεναρίων.</p>
      )}

      <button
        className="recommendation-card__toggle"
        onClick={() => setShowMath((v) => !v)}
        aria-expanded={showMath}
      >
        {showMath ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Δείτε τους υπολογισμούς{set ? " (σενάριο B)" : ""}
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
        <p className="label">Στοιχεία που χρησιμοποιήθηκαν</p>
        {recommendation.portEvent?.email && (
          <FactRow table="email" id={recommendation.portEvent.email.id} label="Email προέλευσης" />
        )}
        {recommendation.portEvent && (
          <FactRow table="portEvent" id={recommendation.portEvent.id} label="Συμβάν λιμανιού" />
        )}
        {recommendation.voyage && (
          <FactRow table="voyage" id={recommendation.voyage.id} label="Ταξίδι" />
        )}
      </div>

      {error && <div className="error-state" role="alert">{error}</div>}

      {recommendation.status === "PENDING" && alternatives > 0 && (
        <p className="recommendation-card__alternatives">
          Μία απόφαση ανά πλοίο: η έγκριση κλείνει {alternatives === 1 ? "την άλλη ανοιχτή επιλογή" : `τις άλλες ${alternatives} ανοιχτές επιλογές`}{" "}
          για το {recommendation.voyage?.vessel?.name ?? "πλοίο"}.
        </p>
      )}
      {recommendation.status === "PENDING" ? (
        <div className="recommendation-card__actions">
          <button className="btn btn-primary" onClick={handleApprove} disabled={busy}>
            Έγκριση{selected ? ` σεναρίου ${selected}` : ""}
          </button>
          <button className="btn" onClick={() => setShowRejectModal(true)} disabled={busy}>
            Απόρριψη
          </button>
          {set && (
            <button className="btn recommendation-card__refresh" onClick={handleRefresh} disabled={busy} title="Επανυπολογισμός με την τελευταία θέση, τον καιρό, τις τιμές και το ναυλοσύμφωνο">
              <RefreshCw size={14} aria-hidden="true" /> Ανανέωση
            </button>
          )}
        </div>
      ) : (
        <div className="recommendation-card__decision">
          <p className="label">
            {STATUS_LABEL[recommendation.status] ?? recommendation.status}
            {recommendation.chosenScenario ? ` · σενάριο ${recommendation.chosenScenario}` : ""} ·{" "}
            {recommendation.decidedAt && new Date(recommendation.decidedAt).toLocaleString("el-GR")}
          </p>
          {recommendation.rejectReason && <p>Αιτιολογία: {recommendation.rejectReason}</p>}
          {recommendation.status === "APPROVED" && (
            <button className="btn recommendation-card__undo" onClick={handleUndo} disabled={busy}>
              Αναίρεση έγκρισης
            </button>
          )}
        </div>
      )}

      {notices
        .filter((n) => n.status !== "WITHDRAWN" || recommendation.status !== "APPROVED")
        .slice(0, 1)
        .map((n) => (
          <NoticePanel
            key={n.id}
            notice={n}
            onChange={(u) => setNotices((all) => all.map((x) => (x.id === u.id ? u : x)))}
          />
        ))}

      {showRejectModal && (
        <div
          className="modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setShowRejectModal(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`reject-title-${recommendation.id}`}>
            <p className="label" id={`reject-title-${recommendation.id}`}>
              Απόρριψη σύστασης
            </p>
            <textarea
              aria-label="Αιτιολογία απόρριψης"
              autoFocus
              placeholder="Αιτιολογία απόρριψης…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowRejectModal(false)} disabled={busy}>
                Ακύρωση
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRejectSubmit}
                disabled={busy || rejectReason.trim().length === 0}
              >
                Απόρριψη
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
