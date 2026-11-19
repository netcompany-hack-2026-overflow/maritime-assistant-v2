import { useEffect, useMemo, useState } from "react";
import { assessCii, type PortDTO, type SeaRouteDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import { PortPickerGlobe } from "../components/PortPickerGlobe.js";
import { CharterPartyDialog } from "../components/CharterPartyDialog.js";
import { STATUS_LABEL } from "../lib/labels.js";
import "./Voyages.css";

const ACTIVE_STATUSES = new Set(["UNDERWAY", "PLANNED"]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

const CO2_FACTOR = 3.114;
const YEAR = new Date().getUTCFullYear();

/** Fuel for a passage at a steady speed, from the vessel's own curve (cube law + auxiliary), t. */
function passageFuelT(distanceNm: number, speedKn: number, vessel: VesselListItem): number {
  const days = distanceNm / speedKn / 24;
  return (vessel.fuelTPerDayAtDesign * (speedKn / vessel.designSpeedKn) ** 3 + vessel.auxFuelTPerDay) * days;
}

/** Berth time against planned arrival: will the ship wait at anchor, be late, or arrive just in time? */
function berthStatus(v: VoyageListItem): { label: string; className: string } {
  if (v.status === "CANCELLED") return { label: "Ακυρώθηκε", className: "jit-badge jit-badge--neutral" };
  if (v.status === "ARRIVED") return { label: "Έφτασε", className: "jit-badge jit-badge--neutral" };
  if (!v.berthTime) return { label: "Κατά πρόγραμμα", className: "jit-badge jit-badge--schedule" };
  const diffH = (new Date(v.berthTime).getTime() - new Date(v.plannedEta).getTime()) / 3_600_000;
  if (diffH > 2) return { label: `Αναμονή ${Math.round(diffH)} h στην άγκυρα`, className: "jit-badge jit-badge--risk" };
  if (diffH < -2) return { label: `Αργεί ${Math.round(-diffH)} h για τη θέση`, className: "jit-badge jit-badge--risk" };
  return { label: "Άφιξη just-in-time", className: "jit-badge jit-badge--optimized" };
}

const CII_BADGE_STYLES: Record<string, React.CSSProperties> = {
  A: { backgroundColor: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  B: { backgroundColor: "#ecfccb", color: "#3f6212", border: "1px solid #bef264" },
  C: { backgroundColor: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  D: { backgroundColor: "#ffedd5", color: "#9a3412", border: "1px solid #fdba74" },
  E: { backgroundColor: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

function CiiBadge({ rating, attained }: { rating?: string | null; attained?: number | null }) {
  if (!rating) return <span>—</span>;
  const style = CII_BADGE_STYLES[rating] ?? CII_BADGE_STYLES.C;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span
        style={{
          ...style,
          padding: "2px 8px",
          borderRadius: "6px",
          fontWeight: 700,
          fontSize: "0.8rem",
          lineHeight: 1.2,
        }}
      >
        {rating}
      </span>
      {attained != null && (
        <span style={{ fontSize: "0.78rem", opacity: 0.75 }}>{attained.toFixed(2)}</span>
      )}
    </span>
  );
}

export function Voyages() {
  const [voyages, setVoyages] = useState<VoyageListItem[]>([]);
  const [vessels, setVessels] = useState<VesselListItem[]>([]);
  const [ports, setPorts] = useState<PortDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [vesselId, setVesselId] = useState("");
  const [originPortId, setOriginPortId] = useState<string | null>(null);
  const [destPortId, setDestPortId] = useState<string | null>(null);
  const [speedKn, setSpeedKn] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cpVoyage, setCpVoyage] = useState<VoyageListItem | null>(null);

  const refresh = () =>
    Promise.all([api.getVoyages(), api.getVessels(), api.getPorts()])
      .then(([v, ve, p]) => {
        setVoyages(v);
        setVessels(ve);
        setPorts(p);
        setError(null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const availableVessels = useMemo(
    () => vessels.filter((v) => !ACTIVE_STATUSES.has(v.status)),
    [vessels]
  );

  const selectedVessel = vessels.find((v) => v.id === vesselId);

  const originPort = ports.find((p) => p.id === originPortId);
  const destPort = ports.find((p) => p.id === destPortId);
  const previewSpeedKn = Number(speedKn) || selectedVessel?.designSpeedKn || 0;

  // Sea route between the picked ports (same route the ship will sail).
  const [route, setRoute] = useState<SeaRouteDTO | null>(null);
  useEffect(() => {
    setRoute(null);
    if (!originPort || !destPort) return;
    let cancelled = false;
    api
      .getSeaRoute(originPort.unlocode, destPort.unlocode)
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {
        /* preview only; creating the voyage still works */
      });
    return () => {
      cancelled = true;
    };
  }, [originPort, destPort]);

  // Estimate for the voyage being created: the sea route, the vessel's own fuel curve, IMO CII.
  const preview = useMemo(() => {
    if (!route || previewSpeedKn <= 0) return null;
    const distanceNm = route.distanceNm;
    const hours = distanceNm / previewSpeedKn;
    const eta = new Date(Date.now() + hours * 3_600_000);
    const fuelT = selectedVessel ? passageFuelT(distanceNm, previewSpeedKn, selectedVessel) : null;
    const co2T = fuelT !== null ? fuelT * CO2_FACTOR : null;
    const cii =
      selectedVessel && co2T !== null ? assessCii(selectedVessel.type, selectedVessel.dwt, co2T, distanceNm, YEAR) : null;
    return { distanceNm, hours, eta, fuelT, co2T, cii };
  }, [route, previewSpeedKn, selectedVessel]);

  const handlePickPort = (portId: string) => {
    if (originPortId === portId) {
      setOriginPortId(null);
      return;
    }
    if (destPortId === portId) {
      setDestPortId(null);
      return;
    }
    if (!originPortId) {
      setOriginPortId(portId);
      return;
    }
    setDestPortId(portId);
  };

  const resetForm = () => {
    setVesselId("");
    setOriginPortId(null);
    setDestPortId(null);
    setSpeedKn("");
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselId || !originPortId || !destPortId) {
      setFormError("Επιλέξτε πλοίο, λιμάνι αναχώρησης και λιμάνι προορισμού.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.createVoyage({
        vesselId,
        originPortId,
        destPortId,
        speedKn: speedKn ? Number(speedKn) : undefined,
      });
      await refresh();
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await api.cancelVoyage(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="page page--voyages">
      <div className="voyages-toolbar">
        <p className="label">Ταξίδια</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm((v) => !v);
            if (showForm) resetForm();
          }}
        >
          {showForm ? "Ακύρωση" : "Νέο ταξίδι"}
        </button>
      </div>

      {showForm && (
        <form className="voyage-form" onSubmit={handleSubmit}>
          <div className="voyage-form__fields">
            <div className="voyage-form__grid">
            <label>
              Πλοίο
              <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} required>
                <option value="" disabled>
                  Επιλέξτε πλοίο…
                </option>
                {availableVessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.type})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Λιμάνι αναχώρησης
              <select
                value={originPortId ?? ""}
                onChange={(e) => setOriginPortId(e.target.value || null)}
                required
              >
                <option value="" disabled>
                  Επιλέξτε αναχώρηση…
                </option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unlocode})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Λιμάνι προορισμού
              <select
                value={destPortId ?? ""}
                onChange={(e) => setDestPortId(e.target.value || null)}
                required
              >
                <option value="" disabled>
                  Επιλέξτε προορισμό…
                </option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unlocode})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Ταχύτητα (kn)
              <input
                type="number"
                min="1"
                step="0.1"
                placeholder={selectedVessel ? selectedVessel.designSpeedKn.toFixed(1) : "π.χ. 14"}
                value={speedKn}
                onChange={(e) => setSpeedKn(e.target.value)}
              />
            </label>
            </div>

            {preview ? (
              <div className="voyage-sim-card">
                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Θαλάσσια απόσταση</span>
                  <span className="voyage-sim-metric__value">{Math.round(preview.distanceNm).toLocaleString("en-US")} nm</span>
                  <span className="voyage-sim-metric__sub">
                    {Math.floor(preview.hours / 24)} μ. {Math.round(preview.hours % 24)} ώ. · ETA {formatDate(preview.eta.toISOString())}
                  </span>
                </div>
                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Εκτ. καύσιμο</span>
                  <span className="voyage-sim-metric__value">{preview.fuelT !== null ? `${preview.fuelT.toFixed(0)} t` : "—"}</span>
                  <span className="voyage-sim-metric__sub">με {previewSpeedKn.toFixed(1)} kn</span>
                </div>
                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Εκτ. CO₂</span>
                  <span className="voyage-sim-metric__value">{preview.co2T !== null ? `${preview.co2T.toFixed(0)} t` : "—"}</span>
                  <span className="voyage-sim-metric__sub">× {CO2_FACTOR} t CO₂/t</span>
                </div>
                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">CII ταξιδιού</span>
                  <div>{preview.cii ? <CiiBadge rating={preview.cii.rating} attained={preview.cii.attained} /> : "—"}</div>
                  <span className="voyage-sim-metric__sub">μέθοδος IMO, {YEAR}</span>
                </div>
              </div>
            ) : (
              <p className="voyage-form__preview">
                Επιλέξτε πλοίο, αναχώρηση και προορισμό (από τις λίστες ή με κλικ στην υδρόγειο) για εκτίμηση απόστασης,
                καυσίμου, CO₂ και CII.
              </p>
            )}

            {formError && <div className="error-state" role="alert">{formError}</div>}

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              Δημιουργία ταξιδιού
            </button>
          </div>

          <PortPickerGlobe
            ports={ports}
            originPortId={originPortId}
            destPortId={destPortId}
            route={route?.coords ?? null}
            onPickPort={handlePickPort}
          />
        </form>
      )}

      {loading ? (
        <div className="loading-state" role="status">Φόρτωση ταξιδιών…</div>
      ) : error ? (
        <div className="error-state" role="alert">{error}</div>
      ) : voyages.length === 0 ? (
        <div className="empty-state">
          <p>Δεν υπάρχουν ακόμα ταξίδια. Δημιουργήστε ένα παραπάνω.</p>
        </div>
      ) : (
        <div className="table-scroll" role="region" aria-label="Πίνακας ταξιδιών" tabIndex={0}>
        <table className="voyage-table">
          <thead>
            <tr>
              <th>Πλοίο</th>
              <th>Διαδρομή</th>
              <th>Ταχύτητα</th>
              <th>Εκτ. CO₂</th>
              <th>Βαθμός CII</th>
              <th>Πρόσδεση</th>
              <th>ETA</th>
              <th>Ναυλοσύμφωνο</th>
              <th>Κατάσταση</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {voyages.map((v) => {
              const vessel = vessels.find((x) => x.id === v.vesselId);
              const co2T = vessel && v.routeNm ? passageFuelT(v.routeNm, v.speedKn, vessel) * CO2_FACTOR : null;
              const berth = berthStatus(v);
              return (
              <tr key={v.id}>
                <td className="voyage-table__vessel">{v.vesselName}</td>
                <td>
                  {v.originPortName} → {v.destPortName}
                </td>
                <td>{v.speedKn.toFixed(1)} kn</td>
                <td title="Όλο το ταξίδι με την τρέχουσα ταχύτητα">{co2T !== null ? `${co2T.toFixed(0)} t` : "—"}</td>
                <td>
                  <CiiBadge rating={v.ciiRating} attained={v.ciiAttained} />
                </td>
                <td>
                  <span className={berth.className} title={v.berthTime ? `Ώρα πρόσδεσης ${formatDate(v.berthTime)}` : undefined}>
                    {berth.label}
                  </span>
                </td>
                <td>{formatDate(v.plannedEta)}</td>
                <td>
                  {ACTIVE_STATUSES.has(v.status) || v.charterParty ? (
                    <button
                      className={v.charterParty ? "btn voyage-cp voyage-cp--on" : "btn voyage-cp"}
                      onClick={() => setCpVoyage(v)}
                      aria-label={`${v.charterParty ? "Προβολή" : "Προσθήκη"} ναυλοσυμφώνου για ${v.vesselName}`}
                    >
                      {v.charterParty ? "Υπάρχει" : "Προσθήκη"}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span className={`voyage-status voyage-status--${v.status.toLowerCase()}`}>
                    {STATUS_LABEL[v.status] ?? v.status}
                  </span>
                </td>
                <td>
                  {ACTIVE_STATUSES.has(v.status) && (
                    <button
                      className="btn"
                      onClick={() => handleCancel(v.id)}
                      aria-label={`Ακύρωση ταξιδιού του ${v.vesselName}`}
                      disabled={cancellingId === v.id}
                    >
                      Ακύρωση
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {cpVoyage && (
        <CharterPartyDialog
          voyage={cpVoyage}
          onClose={(changed) => {
            setCpVoyage(null);
            if (changed) refresh();
          }}
        />
      )}
    </div>
  );
}