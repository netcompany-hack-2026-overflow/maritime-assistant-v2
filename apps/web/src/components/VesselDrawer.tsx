import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { VesselPositionDTO } from "@maritime/shared";
import type { VesselListItem, VoyageListItem } from "../lib/api.js";
import "./VesselDrawer.css";

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
          <dd>{position ? `${position.speedKn.toFixed(1)} kn` : "—"}</dd>
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
          <dd>{formatDateTime(voyage?.plannedEta)}</dd>
        </div>
        <div>
          <dt>Berth time</dt>
          <dd>{formatDateTime(voyage?.berthTime)}</dd>
        </div>
      </dl>

      {hasPendingAction && (
        <Link className="vessel-drawer__action-link" to="/actions">
          Pending action →
        </Link>
      )}
    </aside>
  );
}
