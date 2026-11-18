import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radio, X } from "lucide-react";
import type { VesselPositionDTO } from "@maritime/shared";
import { api, type VesselListItem, type VoyageListItem } from "../lib/api.js";
import "./VesselDrawer.css";

/** Link the vessel to live AIS (aisstream.io) by MMSI. */
function AisLink({ vessel }: { vessel: VesselListItem }) {
  const [mmsi, setMmsi] = useState(vessel.mmsi ?? "");
  const [linked, setLinked] = useState(vessel.mmsi);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMmsi(vessel.mmsi ?? "");
    setLinked(vessel.mmsi);
    api.getMeta().then((m) => setEnabled(m.ais.enabled)).catch(() => setEnabled(null));
  }, [vessel.id, vessel.mmsi]);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.linkAis(vessel.id, value);
      setLinked(res.mmsi);
      setMmsi(res.mmsi ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ais-link"
      onSubmit={(e) => {
        e.preventDefault();
        save(mmsi.trim() || null);
      }}
    >
      <p className="label">
        <Radio size={12} aria-hidden="true" /> Live AIS
      </p>
      <div className="ais-link__row">
        <input
          aria-label="MMSI"
          inputMode="numeric"
          placeholder="MMSI (9 digits)"
          value={mmsi}
          onChange={(e) => setMmsi(e.target.value.replace(/\D/g, "").slice(0, 9))}
        />
        <button className="btn" type="submit" disabled={busy || mmsi === (linked ?? "")}>
          {linked ? "Change" : "Link"}
        </button>
        {linked && (
          <button className="btn" type="button" onClick={() => save(null)} disabled={busy}>
            Unlink
          </button>
        )}
      </div>
      <p className="ais-link__help">
        {enabled === false
          ? "AIS is off: set AISSTREAM_API_KEY in .env and restart the API."
          : linked
            ? "Position, speed and ETA come from AIS when a fix is under 2 h old; pending scenarios update automatically."
            : "Link the ship's MMSI to track it live via aisstream.io."}
      </p>
      {error && <div className="error-state" role="alert">{error}</div>}
    </form>
  );
}

interface VesselDrawerProps {
  vessel: VesselListItem;
  position: VesselPositionDTO | undefined;
  voyage: VoyageListItem | undefined;
  hasPendingAction: boolean;
  onClose: () => void;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function VesselDrawer({
  vessel,
  position,
  voyage,
  hasPendingAction,
  onClose,
}: VesselDrawerProps) {
  return (
    <aside className="vessel-drawer" aria-label={`${vessel.name} details`}>
      <div className="vessel-drawer__header">
        <div>
          <p className="label">Vessel</p>
          <h2 className="vessel-drawer__title">{vessel.name}</h2>
        </div>
        <button className="vessel-drawer__close" onClick={onClose} aria-label={`Close ${vessel.name} details`}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <hr className="hairline" />

      <dl className="vessel-drawer__facts">
        <div>
          <dt>IMO</dt>
          <dd>{vessel.imo}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{vessel.type}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>
            {position ? `${position.speedKn.toFixed(1)} kn` : "—"}
            {position?.source === "ais" && <span className="ais-live">LIVE AIS</span>}
          </dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {position ? `${position.lat.toFixed(2)}, ${position.lon.toFixed(2)}` : "—"}
          </dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            {vessel.originPort ?? "—"} → {vessel.destPort ?? "—"}
          </dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd>{formatDateTime(position?.source === "ais" ? position.etaSim : voyage?.plannedEta)}</dd>
        </div>
        <div>
          <dt>Berth time</dt>
          <dd>{formatDateTime(voyage?.berthTime)}</dd>
        </div>
      </dl>

      {position?.source === "ais" && position.aisAt && (
        <p className="ais-link__help">AIS fix {formatDateTime(position.aisAt)} · MMSI {position.mmsi}</p>
      )}

      <AisLink vessel={vessel} />

      {hasPendingAction && (
        <Link className="vessel-drawer__action-link" to="/actions">
          Pending action →
        </Link>
      )}
    </aside>
  );
}
