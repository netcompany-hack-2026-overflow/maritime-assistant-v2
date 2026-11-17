import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import type { PortDTO, VesselPositionDTO } from "@maritime/shared";

interface GlobePoint {
  kind: "port" | "ship";
  id: string;
  lat: number;
  lng: number;
  label: string;
  pending?: boolean;
}

interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
}

interface GlobePath {
  id: string;
  coords: [number, number][]; // [lat, lng]
  color: string;
  selected: boolean;
}

function headingEndpoint(lat: number, lon: number, headingDeg: number, deltaDeg = 2.5) {
  const rad = (headingDeg * Math.PI) / 180;
  const dLat = deltaDeg * Math.cos(rad);
  const dLon = (deltaDeg * Math.sin(rad)) / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

interface FleetGlobeProps {
  ports: PortDTO[];
  ships: VesselPositionDTO[];
  selectedVesselId: string | null;
  onSelectShip: (vesselId: string) => void;
}

const NAVY = "#0a2a66";
const BLUE = "#1e5eff";
const WARNING = "#b7791f";
/** Ports in green so they stand out from the navy land dots. */
const PORT = "#1f8a5b";

export function FleetGlobe({ ports, ships, selectedVesselId, onSelectShip }: FleetGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [countries, setCountries] = useState<Array<Record<string, unknown>>>([]);
  const hasInteractedRef = useRef(false);
  const flownToRef = useRef<string | null>(null);

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
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    const stopAutoRotate = () => {
      if (!hasInteractedRef.current) {
        hasInteractedRef.current = true;
        controls.autoRotate = false;
      }
    };
    controls.addEventListener("start", stopAutoRotate);
    return () => controls.removeEventListener("start", stopAutoRotate);
  }, []);

  useEffect(() => {
    if (!selectedVesselId || flownToRef.current === selectedVesselId) return;
    const ship = ships.find((s) => s.vesselId === selectedVesselId);
    const globe = globeRef.current;
    if (!ship || !globe) return;
    flownToRef.current = selectedVesselId;
    globe.pointOfView({ lat: ship.lat, lng: ship.lon, altitude: 1.2 }, 1000);
  }, [selectedVesselId, ships]);

  const points: GlobePoint[] = useMemo(() => {
    const portPoints: GlobePoint[] = ports.map((p) => ({
      kind: "port",
      id: p.id,
      lat: p.lat,
      lng: p.lon,
      label: `${p.name} (${p.unlocode})`,
    }));
    const shipPoints: GlobePoint[] = ships.map((s) => ({
      kind: "ship",
      id: s.vesselId,
      lat: s.lat,
      lng: s.lon,
      label: `${s.name} — ${s.speedKn.toFixed(1)} kn`,
      pending: s.hasPendingAction,
    }));
    return [...portPoints, ...shipPoints];
  }, [ports, ships]);

  // Sea route still ahead of each ship (follows coastlines and canals).
  const paths: GlobePath[] = useMemo(
    () =>
      ships
        .filter((s) => s.routeAhead && s.routeAhead.length >= 2)
        .map((s) => ({
          id: s.vesselId,
          coords: s.routeAhead.map((c) => [c.lat, c.lon] as [number, number]),
          color: s.hasPendingAction ? WARNING : BLUE,
          selected: s.vesselId === selectedVesselId,
        })),
    [ships, selectedVesselId]
  );

  // Short tick showing which way each ship is pointing.
  const arcs: GlobeArc[] = useMemo(
    () =>
      ships.map((ship) => {
        const tick = headingEndpoint(ship.lat, ship.lon, ship.heading);
        return {
          startLat: ship.lat,
          startLng: ship.lon,
          endLat: tick.lat,
          endLng: tick.lon,
          color: ship.hasPendingAction ? WARNING : NAVY,
        };
      }),
    [ships]
  );

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: "#f7f9fc", transparent: false }),
    []
  );

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
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
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={0.012}
        pointRadius={(d: object) => ((d as GlobePoint).kind === "ship" ? 0.45 : 0.32)}
        pointColor={(d: object) => {
          const p = d as GlobePoint;
          if (p.kind === "port") return PORT;
          return p.pending ? WARNING : BLUE;
        }}
        pointLabel={(d: object) => (d as GlobePoint).label}
        onPointClick={(d: object) => {
          const p = d as GlobePoint;
          if (p.kind === "ship") onSelectShip(p.id);
        }}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={(d: object) => (d as GlobeArc).color}
        arcStroke={0.8}
        pathsData={paths}
        pathPoints="coords"
        pathPointLat={(c: [number, number]) => c[0]}
        pathPointLng={(c: [number, number]) => c[1]}
        pathPointAlt={0.004}
        pathColor={(d: object) => (d as GlobePath).color}
        pathStroke={(d: object) => ((d as GlobePath).selected ? 1.4 : 0.7)}
        pathDashLength={0.02}
        pathDashGap={0.008}
        pathDashAnimateTime={20000}
        pathTransitionDuration={0}
        labelsData={ports}
        labelLat="lat"
        labelLng="lon"
        labelText="name"
        labelSize={0.55}
        labelDotRadius={0}
        labelAltitude={0.013}
        labelColor={() => PORT}
        labelResolution={2}
      />
    </div>
  );
}
