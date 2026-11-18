import { useEffect, useMemo, useState } from "react";
import type { PortDTO, SeaRouteDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import { PortPickerGlobe } from "../components/PortPickerGlobe.js";
import "./Voyages.css";

const ACTIVE_STATUSES = new Set(["UNDERWAY", "PLANNED"]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function haversineSeaNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  // 1.18 maritime routing detour factor over great-circle distance
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.18;
}

function predictCii(speedKn: number, designSpeedKn: number): { rating: string; attained: number } {
  const ratio = speedKn / Math.max(10, designSpeedKn || 14.5);
  // Cubic propeller law approximation for attained CII (g CO2 / dwt-nm)
  const attained = 4.6 * Math.pow(ratio, 2.3);
  if (attained <= 3.6) return { rating: "A", attained };
  if (attained <= 4.3) return { rating: "B", attained };
  if (attained <= 5.1) return { rating: "C", attained };
  if (attained <= 6.0) return { rating: "D", attained };
  return { rating: "E", attained };
}

const CII_BADGE_STYLES: Record<string, React.CSSProperties> = {
  A: { backgroundColor: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  B: { backgroundColor: "#ecfccb", color: "#3f6212", border: "1px solid #bef264" },
  C: { backgroundColor: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  D: { backgroundColor: "#ffedd5", color: "#9a3412", border: "1px solid #fdba74" },
  E: { backgroundColor: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

function CiiBadge({ rating, attained }: { rating?: string | null; attained?: number | null }) {
  if (!rating) return <span>-</span>;
  const style = CII_BADGE_STYLES[rating] ?? CII_BADGE_STYLES.C;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span
        style={{
          ...style,
          padding: "2px 8px",
          borderRadius: "6px",
          fontWeight: 700,
          fontSize: "0.78rem",
          lineHeight: 1.2,
        }}
      >
        {rating}
      </span>
      {attained != null && (
        <span style={{ fontSize: "0.76rem", color: "#64748b" }}>{attained.toFixed(2)}</span>
      )}
    </span>
  );
}

function getJitStatus(v: VoyageListItem): { label: string; className: string } {
  if (v.status === "CANCELLED") {
    return { label: "Cancelled", className: "jit-badge jit-badge--neutral" };
  }
  if (v.status === "ARRIVED") {
    return { label: "Berthed", className: "jit-badge jit-badge--neutral" };
  }
  // Check berth time vs planned ETA or high fuel-burn speed
  if (v.berthTime) {
    const etaMs = new Date(v.plannedEta).getTime();
    const berthMs = new Date(v.berthTime).getTime();
    const diffHours = (berthMs - etaMs) / 3_600_000;
    if (diffHours > 4) {
      return { label: `Port Delay Risk (+${Math.round(diffHours)}h)`, className: "jit-badge jit-badge--risk" };
    }
    if (Math.abs(diffHours) <= 2) {
      return { label: "JIT Optimized", className: "jit-badge jit-badge--optimized" };
    }
  }
  if (v.speedKn <= 12.2 || v.ciiRating === "A" || v.ciiRating === "B") {
    return { label: "JIT Optimized", className: "jit-badge jit-badge--optimized" };
  }
  if (v.ciiRating === "D" || v.ciiRating === "E" || v.speedKn >= 14.8) {
    return { label: "High Burn / Delay Risk", className: "jit-badge jit-badge--risk" };
  }
  return { label: "On Schedule", className: "jit-badge jit-badge--schedule" };
}

function estimateVoyageCo2Tonnes(v: VoyageListItem, ports: PortDTO[]): number {
  const origin = ports.find((p) => p.name === v.originPortName);
  const dest = ports.find((p) => p.name === v.destPortName);
  const distNm =
    origin && dest ? haversineSeaNm(origin.lat, origin.lon, dest.lat, dest.lon) : 1450;
  const days = distNm / Math.max(8, v.speedKn) / 24;
  const dailyFuelT = 26 * Math.pow(v.speedKn / 14, 3);
  return dailyFuelT * days * 3.114;
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
  const previewSpeedKn = Number(speedKn) || selectedVessel?.designSpeedKn || 13.5;

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
        // Fallback distance calculation handles preview seamlessly
      });
    return () => {
      cancelled = true;
    };
  }, [originPort, destPort]);

  // Live Voyage Simulation: Distance, Transit Time, Fuel, CO2 & Predicted CII
  const simulation = useMemo(() => {
    if (!originPort || !destPort || originPort.id === destPort.id || previewSpeedKn <= 0) {
      return null;
    }
    const distanceNm =
      route?.distanceNm ?? haversineSeaNm(originPort.lat, originPort.lon, destPort.lat, destPort.lon);
    const totalHours = distanceNm / previewSpeedKn;
    const days = Math.floor(totalHours / 24);
    const remHours = Math.round(totalHours % 24);
    const eta = new Date(Date.now() + totalHours * 3_600_000);

    const designSpeed = selectedVessel?.designSpeedKn || 14.5;
    const dailyFuelTonnes = 28 * Math.pow(previewSpeedKn / designSpeed, 3);
    const totalFuelTonnes = dailyFuelTonnes * (totalHours / 24);
    const totalCo2Tonnes = totalFuelTonnes * 3.114;
    const predictedCii = predictCii(previewSpeedKn, designSpeed);

    return {
      distanceNm,
      days,
      remHours,
      eta,
      totalFuelTonnes,
      totalCo2Tonnes,
      predictedCii,
    };
  }, [originPort, destPort, route, previewSpeedKn, selectedVessel]);

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
      setFormError("Choose a vessel, origin port, and destination port.");
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
        <p className="label">Voyages</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm((v) => !v);
            if (showForm) resetForm();
          }}
        >
          {showForm ? "Cancel" : "New voyage"}
        </button>
      </div>

      {showForm && (
        <form className="voyage-form" onSubmit={handleSubmit}>
          <div className="voyage-form__fields">
            <div className="voyage-form__grid">
              <label>
                Vessel
                <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} required>
                  <option value="" disabled>
                    Select a vessel...
                  </option>
                  {availableVessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.type})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Target Speed (kn)
                <input
                  type="number"
                  min="6"
                  max="24"
                  step="0.1"
                  placeholder={selectedVessel ? selectedVessel.designSpeedKn.toFixed(1) : "e.g. 13.5"}
                  value={speedKn}
                  onChange={(e) => setSpeedKn(e.target.value)}
                />
              </label>

              <label>
                Origin port
                <select
                  value={originPortId ?? ""}
                  onChange={(e) => setOriginPortId(e.target.value || null)}
                  required
                >
                  <option value="" disabled>
                    Select origin...
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unlocode})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Destination port
                <select
                  value={destPortId ?? ""}
                  onChange={(e) => setDestPortId(e.target.value || null)}
                  required
                >
                  <option value="" disabled>
                    Select destination...
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.unlocode})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Live Route Telemetry, Fuel, CO2 & Predicted CII Simulator */}
            {simulation ? (
              <div className="voyage-sim-card">
                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Sea Distance</span>
                  <span className="voyage-sim-metric__value">{Math.round(simulation.distanceNm).toLocaleString()} nm</span>
                  <span className="voyage-sim-metric__sub">
                    {simulation.days}d {simulation.remHours}h transit
                  </span>
                </div>

                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Est. Fuel Burn</span>
                  <span className="voyage-sim-metric__value">{simulation.totalFuelTonnes.toFixed(1)} t</span>
                  <span className="voyage-sim-metric__sub">VLSFO @ {previewSpeedKn.toFixed(1)} kn</span>
                </div>

                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Est. CO2</span>
                  <span className="voyage-sim-metric__value">{simulation.totalCo2Tonnes.toFixed(1)} t</span>
                  <span className="voyage-sim-metric__sub">ETA {formatDate(simulation.eta.toISOString())}</span>
                </div>

                <div className="voyage-sim-metric">
                  <span className="voyage-sim-metric__label">Predicted CII</span>
                  <div style={{ marginTop: 2 }}>
                    <CiiBadge
                      rating={simulation.predictedCii.rating}
                      attained={simulation.predictedCii.attained}
                    />
                  </div>
                  <span className="voyage-sim-metric__sub">IMO Intensity</span>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#f8fafc",
                  border: "1px dashed #cbd5e1",
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Pick an origin and destination port (from the dropdowns or by clicking the globe) to simulate distance, fuel burn, CO2, and CII rating.
              </div>
            )}

            {formError && (
              <div className="error-state" role="alert">
                {formError}
              </div>
            )}

            <div>
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create voyage"}
              </button>
            </div>
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
        <div className="loading-state" role="status">
          Loading voyages...
        </div>
      ) : error ? (
        <div className="error-state" role="alert">
          {error}
        </div>
      ) : voyages.length === 0 ? (
        <div className="empty-state">
          <p>No voyages yet. Create one above.</p>
        </div>
      ) : (
        <div className="table-scroll" role="region" aria-label="Voyages table" tabIndex={0}>
          <table className="voyage-table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Route</th>
                <th>Speed</th>
                <th>Est. CO2</th>
                <th>CII Rating</th>
                <th>JIT Status</th>
                <th>ETA</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {voyages.map((v) => {
                const jit = getJitStatus(v);
                const estCo2 = estimateVoyageCo2Tonnes(v, ports);
                return (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600, color: "#0a2a66" }}>{v.vesselName}</td>
                    <td>
                      {v.originPortName} &rarr; {v.destPortName}
                    </td>
                    <td>{v.speedKn.toFixed(1)} kn</td>
                    <td style={{ color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                      {estCo2.toFixed(0)} t
                    </td>
                    <td>
                      <CiiBadge rating={v.ciiRating} attained={v.ciiAttained} />
                    </td>
                    <td>
                      <span className={jit.className}>{jit.label}</span>
                    </td>
                    <td>{formatDate(v.plannedEta)}</td>
                    <td>
                      <span className={`voyage-status voyage-status--${v.status.toLowerCase()}`}>
                        {v.status}
                      </span>
                    </td>
                    <td>
                      {ACTIVE_STATUSES.has(v.status) && (
                        <button
                          className="btn"
                          onClick={() => handleCancel(v.id)}
                          aria-label={`Cancel voyage of ${v.vesselName}`}
                          disabled={cancellingId === v.id}
                        >
                          Cancel
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
    </div>
  );
}