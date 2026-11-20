import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { Compass, Anchor, AlertTriangle, RotateCcw, Navigation, Eye, Waves } from "lucide-react";
import type { PortDTO, VesselPositionDTO } from "@maritime/shared";
import { globeHomeView, setupGlobeControls } from "../lib/globe.js";
import "./FleetGlobe.css";

interface GlobePath {
  id: string;
  coords: [number, number][];
  color: string;
  selected: boolean;
  isWake?: boolean;
}

function headingEndpoint(lat: number, lon: number, headingDeg: number, deltaDeg = 0.85) {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = deltaDeg * Math.cos(rad);
  const dLon = (deltaDeg * Math.sin(rad)) / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatCoords(lat: number, lon: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)} ${latDir}, ${Math.abs(lon).toFixed(2)} ${lonDir}`;
}

const CHOKEPOINTS = [
  { name: "Στενά της Μάλακα", lat: 1.43, lon: 102.89 },
  { name: "Στενά της Σιγκαπούρης", lat: 1.22, lon: 103.82 },
  { name: "Διώρυγα του Σουέζ", lat: 30.58, lon: 32.27 },
  { name: "Στενά του Γιβραλτάρ", lat: 35.96, lon: -5.48 },
  { name: "Στενά της Μάγχης", lat: 50.25, lon: -0.5 },
  { name: "Στενά Μπαμπ ελ-Μαντέμπ", lat: 12.58, lon: 43.33 },
  { name: "Στενά του Ορμούζ", lat: 26.56, lon: 56.25 },
  { name: "Διώρυγα του Παναμά", lat: 9.08, lon: -79.68 },
];

type VesselCategory = "tanker" | "container" | "bulk";

function detectVesselCategory(vesselName: string, vesselType?: string): VesselCategory {
  const combined = `${vesselType || ""} ${vesselName}`.toLowerCase();
  if (combined.includes("tanker") || combined.includes("pioneer") || combined.includes("breeze")) {
    return "tanker";
  }
  if (
    combined.includes("container") ||
    combined.includes("star") ||
    combined.includes("glory") ||
    combined.includes("wind")
  ) {
    return "container";
  }
  return "bulk";
}

interface LiveSeaCamProps {
  shipName: string;
  shipType?: string;
  speedKn: number;
  heading: number;
  hasPendingAction: boolean;
  nearbyChokepoint?: { name: string; distNm: number };
}

function LiveVesselSeaCam({
  shipName,
  shipType,
  speedKn,
  heading,
  hasPendingAction,
  nearbyChokepoint,
}: LiveSeaCamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const category = useMemo(() => detectVesselCategory(shipName, shipType), [shipName, shipType]);
  const isUnderway = speedKn > 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let t = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Maritime Sky & Horizon Haze
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      skyGrad.addColorStop(0, "#3b74a8");
      skyGrad.addColorStop(0.55, "#8cbce3");
      skyGrad.addColorStop(0.92, "#d8eaf8");
      skyGrad.addColorStop(1, "#eef6fc");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h * 0.62);

      // Soft drifting clouds
      ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
      const c1 = ((t * 3.5) % (w + 220)) - 110;
      ctx.beginPath();
      ctx.ellipse(w - c1, h * 0.18, 58, 9, 0, 0, Math.PI * 2);
      ctx.ellipse(w - c1 + 42, h * 0.21, 38, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Deep Ocean Water
      const horizonY = h * 0.60;
      const seaGrad = ctx.createLinearGradient(0, horizonY, 0, h);
      seaGrad.addColorStop(0, "#155e8a");
      seaGrad.addColorStop(0.25, "#0c436b");
      seaGrad.addColorStop(0.65, "#072d4d");
      seaGrad.addColorStop(1, "#031729");
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, horizonY, w, h - horizonY);

      // Horizon shimmer line
      ctx.fillStyle = "rgba(186, 230, 253, 0.35)";
      ctx.fillRect(0, horizonY, w, 1.5);

      // Moving perspective ocean swells & whitecaps
      const speedMult = isUnderway ? Math.max(0.7, speedKn / 11) : 0.18;
      const swellLayers = [
        { y: horizonY + 5, amp: 1.4, freq: 0.045, spd: 1.5, color: "rgba(56, 189, 248, 0.22)" },
        { y: horizonY + 15, amp: 2.3, freq: 0.032, spd: 2.3, color: "rgba(14, 116, 144, 0.42)" },
        { y: horizonY + 28, amp: 3.4, freq: 0.022, spd: 3.2, color: "rgba(3, 105, 161, 0.55)" },
        { y: horizonY + 44, amp: 4.5, freq: 0.016, spd: 4.3, color: "rgba(7, 89, 133, 0.72)" },
      ];

      swellLayers.forEach((layer, idx) => {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 5) {
          const waveY =
            layer.y +
            Math.sin(x * layer.freq + t * layer.spd * speedMult + idx * 1.4) * layer.amp +
            Math.cos(x * layer.freq * 0.45 - t * 1.2) * (layer.amp * 0.35);
          ctx.lineTo(x, waveY);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = layer.color;
        ctx.fill();

        if (isUnderway && idx >= 1) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 10) {
            const val = Math.sin(x * layer.freq + t * layer.spd * speedMult + idx * 1.4);
            if (val > 0.76) {
              const wy = layer.y + val * layer.amp;
              ctx.moveTo(x, wy);
              ctx.lineTo(x + 9, wy + 0.4);
            }
          }
          ctx.stroke();
        }
      });

      t += 0.035;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [speedKn, isUnderway]);

  const typeLabel =
    category === "tanker"
      ? "OIL / CHEMICAL TANKER"
      : category === "container"
      ? "CONTAINER VESSEL"
      : "BULK CARRIER";

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 314,
        width: 350,
        background: "rgba(10, 25, 47, 0.96)",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 12px 30px rgba(10, 42, 102, 0.25)",
        color: "#f8fafc",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 11px",
          background: "rgba(15, 23, 42, 0.95)",
          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
          fontSize: 10.5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isUnderway ? "#22c55e" : "#f59e0b",
              boxShadow: isUnderway ? "0 0 8px #22c55e" : "none",
            }}
          />
          <Eye size={13} color="#38bdf8" />
          <span>{shipName.toUpperCase()}</span>
        </div>
        <span style={{ color: "#7dd3fc", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em" }}>
          {typeLabel}
        </span>
      </div>

      <div style={{ position: "relative", width: "100%", height: 164, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          width={350}
          height={164}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 36,
            width: 285,
            transform: "translateX(-50%)",
            animation: isUnderway ? "shipBob 3.6s ease-in-out infinite" : "none",
            pointerEvents: "none",
          }}
        >
          {category === "tanker" && (
            <svg
              viewBox="0 0 320 92"
              width="100%"
              height="auto"
              style={{ filter: "drop-shadow(0 6px 8px rgba(2,6,23,0.45))" }}
            >
              <polygon points="34,48 34,20 56,20 62,48" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.8" />
              <rect x="38" y="24" width="16" height="3.5" fill="#0f172a" />
              <rect x="38" y="31" width="14" height="2.5" fill="#334155" />
              <line x1="45" y1="20" x2="45" y2="8" stroke="#e2e8f0" strokeWidth="1.5" />
              <line x1="39" y1="12" x2="51" y2="12" stroke="#e2e8f0" strokeWidth="1.2" />
              <polygon points="24,48 26,27 34,27 34,48" fill="#b91c1c" />
              <rect x="25.5" y="27" width="8.5" height="4" fill="#0f172a" />
              <line x1="62" y1="44" x2="262" y2="44" stroke="#cbd5e1" strokeWidth="2.2" />
              <line x1="62" y1="47" x2="262" y2="47" stroke="#94a3b8" strokeWidth="1.5" />
              <line x1="165" y1="48" x2="165" y2="25" stroke="#eab308" strokeWidth="2.2" />
              <line x1="165" y1="27" x2="188" y2="34" stroke="#eab308" strokeWidth="1.6" />
              <line x1="272" y1="43" x2="272" y2="26" stroke="#f8fafc" strokeWidth="1.4" />
              <polygon points="16,48 286,48 298,39 278,66 22,66" fill="#0f172a" />
              <polygon points="22,66 278,66 273,74 25,74" fill="#991b1b" />
              <line x1="19" y1="53" x2="291" y2="53" stroke="#e2e8f0" strokeWidth="1.2" />
            </svg>
          )}

          {category === "container" && (
            <svg
              viewBox="0 0 320 92"
              width="100%"
              height="auto"
              style={{ filter: "drop-shadow(0 6px 8px rgba(2,6,23,0.45))" }}
            >
              <rect x="26" y="34" width="22" height="14" fill="#0284c7" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="28" y="25" width="20" height="9" fill="#ea580c" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="52" y="14" width="18" height="34" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.8" />
              <rect x="54" y="18" width="15" height="3.5" fill="#0f172a" />
              <line x1="61" y1="14" x2="61" y2="4" stroke="#e2e8f0" strokeWidth="1.4" />
              <rect x="46" y="22" width="6" height="14" fill="#1e3a8a" />
              <rect x="74" y="36" width="38" height="12" fill="#1d4ed8" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="74" y="26" width="38" height="10" fill="#dc2626" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="78" y="18" width="32" height="8" fill="#0d9488" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="115" y="36" width="42" height="12" fill="#0369a1" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="115" y="26" width="42" height="10" fill="#f59e0b" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="118" y="17" width="36" height="9" fill="#e2e8f0" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="160" y="36" width="42" height="12" fill="#0f766e" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="160" y="26" width="42" height="10" fill="#2563eb" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="163" y="19" width="35" height="7" fill="#dc2626" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="205" y="36" width="38" height="12" fill="#b45309" stroke="#0f172a" strokeWidth="0.6" />
              <rect x="205" y="27" width="35" height="9" fill="#0284c7" stroke="#0f172a" strokeWidth="0.6" />
              <polygon points="16,48 286,48 299,38 279,66 22,66" fill="#0a2a66" />
              <polygon points="22,66 279,66 274,74 25,74" fill="#b91c1c" />
              <line x1="19" y1="53" x2="291" y2="53" stroke="#38bdf8" strokeWidth="1.2" />
            </svg>
          )}

          {category === "bulk" && (
            <svg
              viewBox="0 0 320 92"
              width="100%"
              height="auto"
              style={{ filter: "drop-shadow(0 6px 8px rgba(2,6,23,0.45))" }}
            >
              <polygon points="32,48 32,18 54,18 60,48" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.8" />
              <rect x="36" y="22" width="16" height="3.5" fill="#0f172a" />
              <line x1="43" y1="18" x2="43" y2="7" stroke="#e2e8f0" strokeWidth="1.4" />
              <rect x="23" y="25" width="9" height="23" fill="#0f766e" />
              <rect x="68" y="42" width="36" height="6" fill="#475569" />
              <rect x="114" y="42" width="36" height="6" fill="#475569" />
              <rect x="160" y="42" width="36" height="6" fill="#475569" />
              <rect x="206" y="42" width="36" height="6" fill="#475569" />
              <line x1="108" y1="48" x2="108" y2="22" stroke="#f59e0b" strokeWidth="2.5" />
              <line x1="108" y1="24" x2="136" y2="33" stroke="#f59e0b" strokeWidth="1.8" />
              <line x1="154" y1="48" x2="154" y2="22" stroke="#f59e0b" strokeWidth="2.5" />
              <line x1="154" y1="24" x2="182" y2="33" stroke="#f59e0b" strokeWidth="1.8" />
              <line x1="200" y1="48" x2="200" y2="22" stroke="#f59e0b" strokeWidth="2.5" />
              <line x1="200" y1="24" x2="228" y2="33" stroke="#f59e0b" strokeWidth="1.8" />
              <polygon points="16,48 286,48 297,39 278,66 22,66" fill="#1e293b" />
              <polygon points="22,66 278,66 273,74 25,74" fill="#991b1b" />
            </svg>
          )}

          {isUnderway && (
            <div
              style={{
                marginTop: -12,
                marginLeft: 14,
                marginRight: 16,
                height: 4,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.85) 0%, rgba(186,230,253,0.9) 55%, rgba(255,255,255,0.95) 92%, rgba(255,255,255,0) 100%)",
                borderRadius: 999,
                filter: "blur(0.8px)",
                animation: "wakeShimmer 1.8s ease-in-out infinite",
              }}
            />
          )}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "16px 11px 7px",
            background: "linear-gradient(to top, rgba(2, 6, 23, 0.85), rgba(2, 6, 23, 0))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0" }}>
            <Waves size={13} color="#38bdf8" />
            <span>
              <strong>{speedKn.toFixed(1)} kn</strong> | πορεία {Math.round(heading)}°
            </span>
          </div>
          <span
            style={{
              background: hasPendingAction ? "rgba(245, 158, 11, 0.25)" : "rgba(56, 189, 248, 0.2)",
              border: hasPendingAction ? "1px solid #f59e0b" : "1px solid #38bdf8",
              color: hasPendingAction ? "#fde68a" : "#bae6fd",
              padding: "1px 7px",
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {nearbyChokepoint ? nearbyChokepoint.name : isUnderway ? "Ανοιχτή θάλασσα" : "Στο λιμάνι"}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes shipBob {
          0%, 100% { transform: translate(-50%, 0px) rotate(-0.5deg); }
          50% { transform: translate(-50%, 2.5px) rotate(0.6deg); }
        }
        @keyframes wakeShimmer {
          0%, 100% { opacity: 0.55; transform: scaleX(0.97); }
          50% { opacity: 1; transform: scaleX(1.02); }
        }
      `}</style>
    </div>
  );
}

interface FleetGlobeProps {
  ports: PortDTO[];
  ships: VesselPositionDTO[];
  selectedVesselId: string | null;
  onSelectShip: (vesselId: string) => void;
}

const NAVY = "#0a2a66";
const BLUE = "#1e5eff";
const WAKE = "#7dd3fc";
const WARNING = "#b7791f";
const PORT = "#1f8a5b";

/** Height of the ship and port icons above the surface, in globe radii. */
const SHIP_ALT = 0.012;
const PORT_ALT = 0.008;
/** Camera altitude when flying to a selected ship (inside the limits in lib/globe.ts). */
const SHIP_VIEW_ALTITUDE = 0.8;
/** Show the sea-cam panel only when the globe is wide enough for it beside the ship panel and the drawer. */
const SEA_CAM_MIN_WIDTH = 1024;
/**
 * The ships move a tiny step every 100 ms and the camera moves with them at once. A
 * transition here would fight the mouse wheel: it would restore the zoom it started from.
 */
const FOLLOW_STEP_MS = 0;

/** Ship seen from above, bow up: pointed bow, rounded stern, bridge aft. Rotated to its course. */
const SHIP_SVG = `<svg viewBox="0 0 16 40" aria-hidden="true" focusable="false">
<path class="ship-marker__body" d="M8 1.5C11.6 6 13.6 11.5 13.8 17.5V35C13.8 37.2 12.4 38.5 10.4 38.5H5.6C3.6 38.5 2.2 37.2 2.2 35V17.5C2.4 11.5 4.4 6 8 1.5Z"/>
<path class="ship-marker__deck" d="M8 9V25"/>
<rect class="ship-marker__bridge" x="4.4" y="28.5" width="7.2" height="5.5" rx="1.2"/>
</svg>`;

/** Port: an anchor on a white disc. */
const ANCHOR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
<circle class="port-marker__disc" cx="12" cy="12" r="11"/>
<g class="port-marker__anchor">
<circle cx="12" cy="6.2" r="1.9"/>
<path d="M12 8.1V19.5M8.6 11.2H15.4M5.8 13.6A6.2 6.2 0 0 0 18.2 13.6"/>
</g>
</svg>`;

/** Port icon size and the room its name takes to the right of it, in px (for hiding overlapping names). */
const PORT_ICON_PX = 16;
const PORT_NAME_CHAR_PX = 6.4;

interface ShipMarker {
  kind: "ship";
  id: string;
  lat: number;
  lng: number;
  el: HTMLButtonElement;
  hull: HTMLSpanElement;
}

interface PortMarker {
  kind: "port";
  id: string;
  lat: number;
  lng: number;
  el: HTMLSpanElement;
  name: HTMLSpanElement;
  /** Width of icon + name, in px. */
  labelWidth: number;
}

type GlobeMarker = ShipMarker | PortMarker;

/**
 * Fixed accessors. A new function on each render would make the globe throw away and rebuild
 * every icon; with these it only moves the existing ones.
 */
const markerElement = (d: object) => (d as GlobeMarker).el;
const markerAltitude = (d: object) => ((d as GlobeMarker).kind === "ship" ? SHIP_ALT : PORT_ALT);

function createShipMarker(id: string, onSelect: (id: string) => void): ShipMarker {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ship-marker";
  const hull = document.createElement("span");
  hull.className = "ship-marker__hull";
  hull.innerHTML = SHIP_SVG;
  el.appendChild(hull);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(id);
  });
  return { kind: "ship", id, lat: 0, lng: 0, el, hull };
}

function createPortMarker(port: PortDTO): PortMarker {
  const el = document.createElement("span");
  el.className = "port-marker";
  el.title = `${port.name} (${port.unlocode})`;
  el.innerHTML = ANCHOR_SVG;
  const name = document.createElement("span");
  name.className = "port-marker__name";
  name.textContent = port.name;
  el.appendChild(name);
  return {
    kind: "port",
    id: port.id,
    lat: port.lat,
    lng: port.lon,
    el,
    name,
    labelWidth: PORT_ICON_PX + 4 + port.name.length * PORT_NAME_CHAR_PX,
  };
}

/** The ship's course as an angle on screen (0 = up), so the bow points the right way from any camera angle. */
function screenBearing(globe: GlobeMethods, lat: number, lng: number, heading: number): number {
  const ahead = headingEndpoint(lat, lng, heading, 0.3);
  const a = globe.getScreenCoords(lat, lng, SHIP_ALT);
  const b = globe.getScreenCoords(ahead.lat, ahead.lon, SHIP_ALT);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.05) return heading;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function FleetGlobe({ ports, ships, selectedVesselId, onSelectShip }: FleetGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [countries, setCountries] = useState<Array<Record<string, unknown>>>([]);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [fleetElapsedSec, setFleetElapsedSec] = useState(0);
  const lastZoomedVesselRef = useRef<string | null>(null);
  /** The camera follows the selected ship from this moment on (Infinity = not following). */
  const followFromRef = useRef(Infinity);
  /** A person is dragging or zooming: the follow waits until they let go. */
  const interactingRef = useRef(false);
  /** The person has moved the camera at least once. */
  const movedRef = useRef(false);
  const onSelectRef = useRef(onSelectShip);
  const shipMarkersRef = useRef(new Map<string, ShipMarker>());
  const portMarkersRef = useRef(new Map<string, PortMarker>());

  useEffect(() => {
    onSelectRef.current = onSelectShip;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/countries.geojson")
      .then((res) => res.json())
      .then((geo: { features: Array<Record<string, unknown>> }) => {
        if (!cancelled) setCountries(geo.features);
      })
      .catch(() => {
        if (!cancelled) setCountries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setFleetElapsedSec((prev) => prev + 0.1);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // No auto-rotation and zoom limits, which depend on the size of the view. Until the person moves
  // the globe or picks a ship, the starting view is refitted too (the real size arrives just after mount).
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    setupGlobeControls(globe, size.width, size.height);
    if (!movedRef.current && !lastZoomedVesselRef.current) {
      globe.pointOfView(globeHomeView(globe, size.width, size.height), 0);
    }
  }, [size.width, size.height]);

  // Noticing when a person moves the camera.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    let startView: { lat: number; lng: number } | null = null;
    const onStart = () => {
      interactingRef.current = true;
      movedRef.current = true;
      const { lat, lng } = globe.pointOfView();
      startView = { lat, lng };
    };
    const onEnd = () => {
      interactingRef.current = false;
      const { lat, lng } = globe.pointOfView();
      // Dragging the globe away from the ship stops following it; zooming keeps following.
      if (startView && (Math.abs(lat - startView.lat) > 0.5 || Math.abs(lng - startView.lng) > 0.5)) {
        followFromRef.current = Infinity;
      }
      startView = null;
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    };
  }, []);

  const animatedShips = useMemo(() => {
    return ships.map((ship) => {
      const route = ship.routeAhead;
      const isUnderway = ship.speedKn > 0.5;
      const degPerSec = isUnderway ? (ship.speedKn / 12) * 0.022 : 0;
      let remainingDeg = fleetElapsedSec * degPerSec;

      if (route && route.length >= 2 && isUnderway) {
        const wakeCoords: [number, number][] = [[route[0].lat, route[0].lon]];
        for (let i = 0; i < route.length - 1; i++) {
          const p1 = route[i];
          const p2 = route[i + 1];
          const segLen = Math.hypot(p2.lat - p1.lat, p2.lon - p1.lon);
          if (segLen < 0.0001) continue;

          if (remainingDeg <= segLen) {
            const frac = remainingDeg / segLen;
            const liveLat = p1.lat + (p2.lat - p1.lat) * frac;
            const liveLon = p1.lon + (p2.lon - p1.lon) * frac;
            const segHeading = bearingDeg(p1.lat, p1.lon, p2.lat, p2.lon);
            wakeCoords.push([liveLat, liveLon]);
            const aheadCoords: [number, number][] = [
              [liveLat, liveLon],
              ...route.slice(i + 1).map((c) => [c.lat, c.lon] as [number, number]),
            ];
            return {
              ...ship,
              liveLat,
              liveLon,
              liveHeading: Number.isFinite(segHeading) ? segHeading : ship.heading,
              wakeCoords,
              aheadCoords,
            };
          }
          remainingDeg -= segLen;
          wakeCoords.push([p2.lat, p2.lon]);
        }

        const lastPt = route[route.length - 1];
        return {
          ...ship,
          liveLat: lastPt.lat,
          liveLon: lastPt.lon,
          liveHeading: ship.heading,
          wakeCoords,
          aheadCoords: [] as [number, number][],
        };
      }

      if (isUnderway) {
        const pos = headingEndpoint(ship.lat, ship.lon, ship.heading || 60, remainingDeg);
        return {
          ...ship,
          liveLat: pos.lat,
          liveLon: pos.lon,
          liveHeading: ship.heading || 60,
          wakeCoords: [
            [ship.lat, ship.lon] as [number, number],
            [pos.lat, pos.lon] as [number, number],
          ],
          aheadCoords: [] as [number, number][],
        };
      }

      return {
        ...ship,
        liveLat: ship.lat,
        liveLon: ship.lon,
        liveHeading: ship.heading,
        wakeCoords: [] as [number, number][],
        aheadCoords: [] as [number, number][],
      };
    });
  }, [ships, fleetElapsedSec]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (!selectedVesselId) {
      lastZoomedVesselRef.current = null;
      followFromRef.current = Infinity;
      setIsZoomedIn(false);
      return;
    }
    if (lastZoomedVesselRef.current === selectedVesselId) return;

    const ship = animatedShips.find((s) => s.vesselId === selectedVesselId);
    if (!ship) return;

    lastZoomedVesselRef.current = selectedVesselId;
    setIsZoomedIn(true);
    globe.pointOfView({ lat: ship.liveLat, lng: ship.liveLon, altitude: SHIP_VIEW_ALTITUDE }, 1100);
    // Follow the ship once the fly-in has finished.
    followFromRef.current = Date.now() + 1150;
  }, [selectedVesselId, animatedShips]);

  // Keep the selected ship in the centre as it sails: the camera moves with it, at the zoom the person chose.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !selectedVesselId || interactingRef.current) return;
    if (Date.now() < followFromRef.current) return;
    const ship = animatedShips.find((s) => s.vesselId === selectedVesselId);
    if (!ship) return;
    const { altitude } = globe.pointOfView();
    globe.pointOfView({ lat: ship.liveLat, lng: ship.liveLon, altitude }, FOLLOW_STEP_MS);
  }, [selectedVesselId, animatedShips]);

  const handleResetView = () => {
    const globe = globeRef.current;
    if (!globe) return;
    setIsZoomedIn(false);
    followFromRef.current = Infinity;
    globe.pointOfView(globeHomeView(globe, size.width, size.height), 1000);
  };

  const selectedSurroundings = useMemo(() => {
    if (!selectedVesselId) return null;
    const ship = animatedShips.find((s) => s.vesselId === selectedVesselId);
    if (!ship) return null;

    const nearbyPorts = ports
      .map((p) => ({
        name: p.name,
        unlocode: p.unlocode,
        distNm: Math.round(distanceNm(ship.liveLat, ship.liveLon, p.lat, p.lon)),
      }))
      .sort((a, b) => a.distNm - b.distNm)
      .slice(0, 3);

    const nearbyChokepoint = CHOKEPOINTS.map((c) => ({
      name: c.name,
      distNm: Math.round(distanceNm(ship.liveLat, ship.liveLon, c.lat, c.lon)),
    }))
      .filter((c) => c.distNm <= 450)
      .sort((a, b) => a.distNm - b.distNm)[0];

    const nearbyVessels = animatedShips
      .filter((other) => other.vesselId !== ship.vesselId)
      .map((other) => ({
        name: other.name,
        distNm: Math.round(distanceNm(ship.liveLat, ship.liveLon, other.liveLat, other.liveLon)),
      }))
      .filter((v) => v.distNm <= 800)
      .sort((a, b) => a.distNm - b.distNm);

    return { ship, nearbyPorts, nearbyChokepoint, nearbyVessels };
  }, [selectedVesselId, animatedShips, ports]);

  // Port and ship icons. The marker objects are kept between ticks so the globe moves the same
  // HTML elements instead of building new ones every 100 ms.
  const portMarkers = useMemo(() => {
    const prev = portMarkersRef.current;
    const next = new Map<string, PortMarker>();
    for (const p of ports) {
      const marker = prev.get(p.id) ?? createPortMarker(p);
      marker.lat = p.lat;
      marker.lng = p.lon;
      next.set(p.id, marker);
    }
    portMarkersRef.current = next;
    return [...next.values()];
  }, [ports]);

  const shipMarkers = useMemo(() => {
    const prev = shipMarkersRef.current;
    const next = new Map<string, ShipMarker>();
    for (const s of animatedShips) {
      const marker = prev.get(s.vesselId) ?? createShipMarker(s.vesselId, (id) => onSelectRef.current(id));
      marker.lat = s.liveLat;
      marker.lng = s.liveLon;
      next.set(s.vesselId, marker);
    }
    shipMarkersRef.current = next;
    return [...next.values()];
  }, [animatedShips]);

  // Ships after ports, so a ship is drawn over a port it is passing.
  const markers: GlobeMarker[] = useMemo(() => [...portMarkers, ...shipMarkers], [portMarkers, shipMarkers]);

  // Each tick: colour and size of every ship, its bow along the course, and which port names fit.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    for (const s of animatedShips) {
      const marker = shipMarkersRef.current.get(s.vesselId);
      if (!marker) continue;
      const selected = s.vesselId === selectedVesselId;
      const className = [
        "ship-marker",
        s.hasPendingAction ? "ship-marker--pending" : "",
        selected ? "ship-marker--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (marker.el.className !== className) marker.el.className = className;
      const label = `${s.name} · ${s.speedKn.toFixed(1)} kn${s.hasPendingAction ? " · ενέργεια σε αναμονή" : ""}`;
      if (marker.el.title !== label) {
        marker.el.title = label;
        marker.el.setAttribute("aria-label", label);
      }
      marker.hull.style.transform = `rotate(${screenBearing(globe, s.liveLat, s.liveLon, s.liveHeading).toFixed(1)}deg)`;
    }

    // A port name is shown unless it would cover a name already shown (e.g. Algeciras, Gibraltar, Ceuta).
    const placed: Array<[number, number, number, number]> = [];
    for (const marker of portMarkersRef.current.values()) {
      if (marker.el.style.display === "none") continue; // on the far side of the globe
      const { x, y } = globe.getScreenCoords(marker.lat, marker.lng, PORT_ALT);
      const half = PORT_ICON_PX / 2;
      const box: [number, number, number, number] = [x - half, y - half, x - half + marker.labelWidth, y + half];
      const free =
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        placed.every((b) => box[0] > b[2] || box[2] < b[0] || box[1] > b[3] || box[3] < b[1]);
      if (marker.name.hidden === free) marker.name.hidden = !free;
      if (free) placed.push(box);
    }
  }, [animatedShips, selectedVesselId]);

  const paths: GlobePath[] = useMemo(() => {
    const list: GlobePath[] = [];
    for (const s of animatedShips) {
      const isSelected = s.vesselId === selectedVesselId;
      if (s.wakeCoords.length >= 2) {
        list.push({
          id: `${s.vesselId}-wake`,
          coords: s.wakeCoords,
          color: isSelected ? WAKE : "#93c5fd",
          selected: isSelected,
          isWake: true,
        });
      }
      if (s.aheadCoords.length >= 2) {
        list.push({
          id: `${s.vesselId}-ahead`,
          coords: s.aheadCoords,
          color: s.hasPendingAction ? WARNING : BLUE,
          selected: isSelected,
          isWake: false,
        });
      }
    }
    return list;
  }, [animatedShips, selectedVesselId]);

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: "#f0f5fc", transparent: false }),
    []
  );

  return (
    // `isolation` keeps the icons' z-index (set by globe.gl) inside the globe, so the savings tile
    // and the vessel drawer stay on top; the globe's own layer keeps them under the panels below.
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", isolation: "isolate" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={globeMaterial}
          showAtmosphere={false}
          hexPolygonsData={countries}
          hexPolygonResolution={4}
          hexPolygonMargin={0.3}
          hexPolygonUseDots={true}
          hexPolygonColor={() => "#0a2a66"}
          htmlElementsData={markers}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={markerAltitude}
          htmlElement={markerElement}
          htmlTransitionDuration={0}
          pathsData={paths}
          pathPoints="coords"
          pathPointLat={(c: [number, number]) => c[0]}
          pathPointLng={(c: [number, number]) => c[1]}
          pathPointAlt={0.004}
          pathColor={(d: object) => (d as GlobePath).color}
          pathStroke={(d: object) => {
            const p = d as GlobePath;
            if (p.isWake) return p.selected ? 2.4 : 0.8;
            return p.selected ? 1.5 : 0.7;
          }}
          pathDashLength={(d: object) => ((d as GlobePath).isWake ? 1 : 0.02)}
          pathDashGap={(d: object) => ((d as GlobePath).isWake ? 0 : 0.008)}
          pathDashAnimateTime={(d: object) => ((d as GlobePath).isWake ? 0 : 8000)}
          pathTransitionDuration={0}
        />
      </div>

      {selectedSurroundings && (
        <>
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              width: 285,
              maxWidth: "calc(100% - 32px)",
              background: "rgba(255, 255, 255, 0.95)",
              backdropFilter: "blur(8px)",
              border: "1px solid #dbe4f0",
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: "0 8px 24px rgba(10, 42, 102, 0.12)",
              fontSize: 12,
              color: "#1e293b",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "4px 8px",
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: NAVY, fontSize: 13 }}>
                <Navigation size={14} color={BLUE} style={{ flexShrink: 0 }} />
                <span>{selectedSurroundings.ship.name}</span>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  background: "#eff6ff",
                  color: BLUE,
                  padding: "2px 7px",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                {`${selectedSurroundings.ship.speedKn.toFixed(1)} kn | πορεία ${Math.round(selectedSurroundings.ship.liveHeading)}°`}
              </span>
            </div>

            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <Compass size={12} />
              <span>Θέση: {formatCoords(selectedSurroundings.ship.liveLat, selectedSurroundings.ship.liveLon)}</span>
            </div>

            {selectedSurroundings.nearbyChokepoint && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                  borderRadius: 8,
                  padding: "6px 8px",
                  marginBottom: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                <AlertTriangle size={13} color={WARNING} style={{ flexShrink: 0 }} />
                <span>
                  Κοντά σε <strong>{selectedSurroundings.nearbyChokepoint.name}</strong> ({selectedSurroundings.nearbyChokepoint.distNm} nm)
                </span>
              </div>
            )}

            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 7 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: 5 }}>
                Κοντινά λιμάνια
              </div>
              {selectedSurroundings.nearbyPorts.map((port) => (
                <div
                  key={port.unlocode}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "2px 0",
                    fontSize: 11.5,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#0f172a" }}>
                    <Anchor size={11} color={PORT} />
                    {port.name}
                  </span>
                  <span style={{ fontWeight: 600, color: "#475569" }}>{port.distNm} nm</span>
                </div>
              ))}
            </div>

            {selectedSurroundings.nearbyVessels.length > 0 && (
              <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 6, fontSize: 11, color: "#475569" }}>
                <strong>Πλοία του στόλου κοντά:</strong>{" "}
                {selectedSurroundings.nearbyVessels.map((v) => `${v.name} (${v.distNm} nm)`).join(", ")}
              </div>
            )}

            {isZoomedIn && (
              <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 8, paddingTop: 8 }}>
                <button type="button" className="btn btn-sm" onClick={handleResetView}>
                  <RotateCcw size={13} aria-hidden="true" />
                  Όλος ο στόλος
                </button>
              </div>
            )}
          </div>

          {size.width >= SEA_CAM_MIN_WIDTH && (
            <LiveVesselSeaCam
              shipName={selectedSurroundings.ship.name}
              shipType={(selectedSurroundings.ship as { type?: string }).type}
              speedKn={selectedSurroundings.ship.speedKn}
              heading={selectedSurroundings.ship.liveHeading}
              hasPendingAction={selectedSurroundings.ship.hasPendingAction}
              nearbyChokepoint={selectedSurroundings.nearbyChokepoint}
            />
          )}
        </>
      )}
    </div>
  );
}
