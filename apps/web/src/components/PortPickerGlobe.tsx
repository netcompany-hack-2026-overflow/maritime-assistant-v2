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
  const [size, setSize] = useState({ width: 280, height: 280 });
  const [countries, setCountries] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
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
    controls.autoRotateSpeed = 0.6;
  }, []);

  const globeMaterial = useMemo(() => new THREE.MeshPhongMaterial({ color: "#f7f9fc" }), []);

  const paths = useMemo(
    () => (route && route.length >= 2 ? [{ coords: route.map((c) => [c.lat, c.lon]) }] : []),
    [route]
  );

  // Turn the globe to face the picked route.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !route || route.length < 2) return;
    const mid = route[Math.floor(route.length / 2)];
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: mid.lat, lng: mid.lon, altitude: 2.2 }, 800);
  }, [route]);

  return (
    <div ref={containerRef} className="port-picker-globe">
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
          return p.id === originPortId || p.id === destPortId ? 0.55 : 0.3;
        }}
        pointColor={(d: object) => {
          const p = d as PortDTO;
          if (p.id === originPortId) return BLUE;
          if (p.id === destPortId) return WARNING;
          return PORT;
        }}
        pointLabel={(d: object) => {
          const p = d as PortDTO;
          return `${p.name} (${p.unlocode})`;
        }}
        onPointClick={(d: object) => onPickPort((d as PortDTO).id)}
        pathsData={paths}
        pathPoints="coords"
        pathPointLat={(c: number[]) => c[0]}
        pathPointLng={(c: number[]) => c[1]}
        pathPointAlt={0.004}
        pathColor={() => BLUE}
        pathStroke={1.2}
        pathDashLength={0.03}
        pathDashGap={0.01}
        pathDashAnimateTime={12000}
        pathTransitionDuration={0}
      />
    </div>
  );
}
