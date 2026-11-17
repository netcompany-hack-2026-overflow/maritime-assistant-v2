import { useEffect, useState } from "react";
import type { PortDTO, VesselPositionDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import { FleetGlobe } from "../components/FleetGlobe.js";
import { VesselDrawer } from "../components/VesselDrawer.js";
import "./Fleet.css";

const POLL_INTERVAL_MS = 2000;

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
        <div className="fleet-layout__globe">
          {loading ? (
            <div className="loading-state">Loading fleet…</div>
          ) : error ? (
            <div className="error-state">{error}</div>
          ) : (
            <FleetGlobe
              ports={ports}
              ships={positions}
              selectedVesselId={selectedVesselId}
              onSelectShip={setSelectedVesselId}
            />
          )}
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
          <p className="label">Ships</p>
          {vessels.length === 0 ? (
            <div className="empty-state">No vessels yet.</div>
          ) : (
            <ul className="ship-list">
              {vessels.map((v) => (
                <li key={v.id}>
                  <button
                    className={
                      v.id === selectedVesselId
                        ? "ship-list__item ship-list__item--active"
                        : "ship-list__item"
                    }
                    onClick={() => setSelectedVesselId(v.id)}
                  >
                    <span className="ship-list__name">{v.name}</span>
                    <span className="ship-list__meta">
                      {v.status} · {v.speedKn ? `${v.speedKn.toFixed(1)} kn` : "—"} ·{" "}
                      {v.destPort ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
