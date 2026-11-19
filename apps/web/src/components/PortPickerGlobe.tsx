import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import type { LatLon, PortDTO } from "@maritime/shared";
import "./PortPickerGlobe.css";

interface PortPickerGlobeProps {
  ports: PortDTO[];
  originPortId: string | null;
  destPortId: string | null;
  /** Sea route between the picked ports, if known. */
  route: LatLon[] | null;
  onPickPort: (portId: string) => void;
}

const NAVY = "#0a2a66";
const BLUE = "#1e5eff";
const WARNING = "#b7791f";
const PORT = "#1f8a5b";

export function PortPickerGlobe({ ports, originPortId, destPortId, route, onPickPort }: PortPickerGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 320, height: 290 });
  const [countries, setCountries] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: Math.max(240, entry.contentRect.width),
          height: Math.max(240, entry.contentRect.height),
        });
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

  const originPort = useMemo(() => ports.find((p) => p.id === originPortId) ?? null, [ports, originPortId]);
  const destPort = useMemo(() => ports.find((p) => p.id === destPortId) ?? null, [ports, destPortId]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = !originPort && !destPort;
    controls.autoRotateSpeed = 0.6;
  }, [originPort, destPort]);

  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: "#f0f5fc" }), []);

  const paths = useMemo(
    () => (route && route.length >= 2 ? [{ coords: route.map((c) => [c.lat, c.lon]) }] : []),
    [route]
  );

  // Instant great-circle arc preview whenever both origin & destination are chosen
  const arcs = useMemo(() => {
    if (!originPort || !destPort) return [];
    // If detailed sea path already exists, render a subtle guiding arc; otherwise render primary route arc
    return [
      {
        startLat: originPort.lat,
        startLng: originPort.lon,
        endLat: destPort.lat,
        endLng: destPort.lon,
      },
    ];
  }, [originPort, destPort]);

  // Pulse rings on picked Origin & Destination ports
  const rings = useMemo(() => {
    const list: Array<{ lat: number; lng: number; color: string }> = [];
    if (originPort) list.push({ lat: originPort.lat, lng: originPort.lon, color: "rgba(30, 94, 255, 0.7)" });
    if (destPort) list.push({ lat: destPort.lat, lng: destPort.lon, color: "rgba(183, 121, 31, 0.75)" });
    return list;
  }, [originPort, destPort]);

  // Turn the globe to face the picked port(s) or route immediately
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (route && route.length >= 2) {
      const mid = route[Math.floor(route.length / 2)];
      globe.controls().autoRotate = false;
      globe.pointOfView({ lat: mid.lat, lng: mid.lon, altitude: 1.95 }, 800);
      return;
    }

    if (originPort && destPort) {
      const midLat = (originPort.lat + destPort.lat) / 2;
      const midLon = (originPort.lon + destPort.lon) / 2;
      globe.controls().autoRotate = false;
      globe.pointOfView({ lat: midLat, lng: midLon, altitude: 2.0 }, 800);
      return;
    }

    if (originPort) {
      globe.controls().autoRotate = false;
      globe.pointOfView({ lat: originPort.lat, lng: originPort.lon, altitude: 1.7 }, 700);
    }
  }, [route, originPort, destPort]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        ref={containerRef}
        className="port-picker-globe"
        style={{
          minHeight: 270,
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #dbe4f0",
          background: "#f8fafc",
        }}
      >
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
          hexPolygonColor={() => NAVY}
          pointsData={ports}
          pointLat="lat"
          pointLng="lon"
          pointAltitude={0.015}
          pointRadius={(d: object) => {
            const p = d as PortDTO;
            return p.id === originPortId || p.id === destPortId ? 0.65 : 0.34;
          }}
          pointColor={(d: object) => {
            const p = d as PortDTO;
            if (p.id === originPortId) return BLUE;
            if (p.id === destPortId) return WARNING;
            return PORT;
          }}
          pointLabel={(d: object) => {
            const p = d as PortDTO;
            return `${p.name} (${p.unlocode}) - κλικ για επιλογή`;
          }}
          onPointClick={(d: object) => onPickPort((d as PortDTO).id)}
          ringsData={rings}
          ringLat="lat"
          ringLng="lng"
          ringMaxRadius={3.2}
          ringPropagationSpeed={2}
          ringRepeatPeriod={1200}
          ringColor={(d: object) => (d as { color: string }).color}
          arcsData={paths.length === 0 ? arcs : []}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={() => [BLUE, WARNING]}
          arcStroke={0.65}
          arcDashLength={0.35}
          arcDashGap={0.15}
          arcDashAnimateTime={2200}
          pathsData={paths}
          pathPoints="coords"
          pathPointLat={(c: number[]) => c[0]}
          pathPointLng={(c: number[]) => c[1]}
          pathPointAlt={0.004}
          pathColor={() => BLUE}
          pathStroke={1.6}
          pathDashLength={0.04}
          pathDashGap={0.012}
          pathDashAnimateTime={9000}
          pathTransitionDuration={0}
        />
      </div>

      {/* Interactive Globe Legend */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          color: "#64748b",
          padding: "0 2px",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: BLUE }} />
          {originPort ? originPort.unlocode : "Αναχώρηση"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: WARNING }} />
          {destPort ? destPort.unlocode : "Προορισμός"}
        </span>
        <span style={{ fontStyle: "italic" }}>Κάντε κλικ σε λιμάνια στην υδρόγειο</span>
      </div>
    </div>
  );
}