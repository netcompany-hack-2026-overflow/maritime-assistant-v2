import { useEffect, useState } from "react";
import type { PortDTO, VesselPositionDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import { FleetGlobe } from "../components/FleetGlobe.js";
import { VesselDrawer } from "../components/VesselDrawer.js";
import { SavingsTile } from "../components/SavingsTile.js";
import { STATUS_LABEL } from "../lib/labels.js";
import "./Fleet.css";

const POLL_INTERVAL_MS = 2000;

const CII_BADGE_STYLES: Record<string, React.CSSProperties> = {
  A: { backgroundColor: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  B: { backgroundColor: "#ecfccb", color: "#3f6212", border: "1px solid #bef264" },
  C: { backgroundColor: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" },
  D: { backgroundColor: "#ffedd5", color: "#9a3412", border: "1px solid #fdba74" },
  E: { backgroundColor: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" },
};

export function Fleet() {
  const [ports, setPorts] = useState<PortDTO[]>([]);
  const [vessels, setVessels] = useState<VesselListItem[]>([]);
  const [voyages, setVoyages] = useState<VoyageListItem[]>([]);
  const [positions, setPositions] = useState<VesselPositionDTO[]>([]);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .getPorts()
      .then((p) => {
        if (!cancelled) setPorts(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });

    const poll = () => {
      Promise.all([api.getVesselPositions(), api.getVessels(), api.getVoyages()])
        .then(([pos, ves, voy]) => {
          if (cancelled) return;
          setPositions(pos);
          setVessels(ves);
          setVoyages(voy);
          setError(null);
          setLoading(false);
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e.message);
            setLoading(false);
          }
        });
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const selectedVessel = vessels.find((v) => v.id === selectedVesselId) ?? null;
  const selectedPosition = positions.find((p) => p.vesselId === selectedVesselId);
  const selectedVoyage = voyages.find((v) => v.id === selectedVessel?.voyageId);

  return (
    <div className="page page--fleet">
      <div className="fleet-layout">
        <div className="fleet-layout__globe" role="region" aria-label="Ζωντανή υδρόγειος του στόλου. Με το πληκτρολόγιο επιλέξτε πλοίο από τη λίστα.">
          <div className="fleet-layout__canvas">
          {loading ? (
            <div className="loading-state" role="status">Φόρτωση στόλου…</div>
          ) : error ? (
            <div className="error-state" role="alert">{error}</div>
          ) : (
            <FleetGlobe
              ports={ports}
              ships={positions}
              selectedVesselId={selectedVesselId}
              onSelectShip={setSelectedVesselId}
            />
          )}
          </div>
          {!loading && !error && <SavingsTile />}
          {selectedVessel && (
            <VesselDrawer
              vessel={selectedVessel}
              position={selectedPosition}
              voyage={selectedVoyage}
              hasPendingAction={
                positions.find((p) => p.vesselId === selectedVessel.id)?.hasPendingAction ??
                false
              }
              onClose={() => setSelectedVesselId(null)}
            />
          )}
        </div>
        <div className="fleet-layout__list">
          <h2 className="label">Πλοία</h2>
          {vessels.length === 0 ? (
            <div className="empty-state">Δεν υπάρχουν ακόμα πλοία.</div>
          ) : (
            <ul className="ship-list">
              {vessels.map((v) => {
                const activeVoyage = voyages.find((voy) => voy.id === v.voyageId);
                const ciiRating = activeVoyage?.ciiRating;
                return (
                  <li key={v.id}>
                    <button
                      className={
                        v.id === selectedVesselId
                          ? "ship-list__item ship-list__item--active"
                          : "ship-list__item"
                      }
                      onClick={() => setSelectedVesselId(v.id)}
                      aria-pressed={v.id === selectedVesselId}
                    >
                      <span
                        className="ship-list__name"
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
                      >
                        <span>{v.name}</span>
                        {ciiRating && (
                          <span
                            style={{
                              ...(CII_BADGE_STYLES[ciiRating] ?? CII_BADGE_STYLES.C),
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "0.72rem",
                              fontWeight: 700,
                            }}
                          >
                            CII {ciiRating}
                          </span>
                        )}
                      </span>
                      <span className="ship-list__meta">
                        {STATUS_LABEL[v.status] ?? v.status} · {v.speedKn ? `${v.speedKn.toFixed(1)} kn` : "—"} ·{" "}
                        {v.destPort ?? "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}