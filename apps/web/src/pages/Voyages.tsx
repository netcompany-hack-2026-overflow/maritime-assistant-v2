import { useEffect, useMemo, useState } from "react";
import { haversineNm } from "@maritime/shared";
import type { PortDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import { PortPickerGlobe } from "../components/PortPickerGlobe.js";
import "./Voyages.css";

const ACTIVE_STATUSES = new Set(["UNDERWAY", "PLANNED"]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
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
  const previewSpeedKn = Number(speedKn) || selectedVessel?.designSpeedKn || 0;

  const preview = useMemo(() => {
    if (!originPort || !destPort || previewSpeedKn <= 0) return null;
    const distanceNm = haversineNm(
      { lat: originPort.lat, lon: originPort.lon },
      { lat: destPort.lat, lon: destPort.lon }
    );
    const hours = distanceNm / previewSpeedKn;
    const eta = new Date(Date.now() + hours * 3_600_000);
    return { distanceNm, eta };
  }, [originPort, destPort, previewSpeedKn]);

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
            <label>
              Vessel
              <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} required>
                <option value="" disabled>
                  Select a vessel…
                </option>
                {availableVessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.type})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Origin port
              <select
                value={originPortId ?? ""}
                onChange={(e) => setOriginPortId(e.target.value || null)}
                required
              >
                <option value="" disabled>
                  Select origin…
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
                  Select destination…
                </option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unlocode})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Speed (kn)
              <input
                type="number"
                min="1"
                step="0.1"
                placeholder={selectedVessel ? selectedVessel.designSpeedKn.toFixed(1) : "e.g. 14"}
                value={speedKn}
                onChange={(e) => setSpeedKn(e.target.value)}
              />
            </label>

            {preview && (
              <p className="voyage-form__preview">
                {preview.distanceNm.toFixed(0)} nm · ETA {preview.eta.toLocaleString()}
              </p>
            )}

            {formError && <div className="error-state" role="alert">{formError}</div>}

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              Create voyage
            </button>
          </div>

          <PortPickerGlobe
            ports={ports}
            originPortId={originPortId}
            destPortId={destPortId}
            onPickPort={handlePickPort}
          />
        </form>
      )}

      {loading ? (
        <div className="loading-state" role="status">Loading voyages…</div>
      ) : error ? (
        <div className="error-state" role="alert">{error}</div>
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
              <th>Departed</th>
              <th>ETA</th>
              <th>Berth time</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {voyages.map((v) => (
              <tr key={v.id}>
                <td>{v.vesselName}</td>
                <td>
                  {v.originPortName} → {v.destPortName}
                </td>
                <td>{v.speedKn.toFixed(1)} kn</td>
                <td>{formatDate(v.departedAt)}</td>
                <td>{formatDate(v.plannedEta)}</td>
                <td>{v.berthTime ? formatDate(v.berthTime) : "—"}</td>
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
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
