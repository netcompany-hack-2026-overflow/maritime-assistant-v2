import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import type { PortDTO } from "@maritime/shared";
import "./PortPickerGlobe.css";

interface PortPickerGlobeProps {
  ports: PortDTO[];
  originPortId: string | null;
  destPortId: string | null;
  onPickPort: (portId: string) => void;
}

const NAVY = "#0a2a66";
const BLUE = "#1e5eff";
const WARNING = "#b7791f";

export function PortPickerGlobe({ ports, originPortId, destPortId, onPickPort }: PortPickerGlobeProps) {
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

  const originPort = ports.find((p) => p.id === originPortId);
  const destPort = ports.find((p) => p.id === destPortId);
  const arcs = useMemo(
    () =>
      originPort && destPort
        ? [
            {
              startLat: originPort.lat,
              startLng: originPort.lon,
              endLat: destPort.lat,
              endLng: destPort.lon,
            },
          ]
        : [],
    [originPort, destPort]
  );

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
        hexPolygonResolution={3}
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
          return NAVY;
        }}
        pointLabel={(d: object) => {
          const p = d as PortDTO;
          return `${p.name} (${p.unlocode})`;
        }}
        onPointClick={(d: object) => onPickPort((d as PortDTO).id)}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={() => BLUE}
        arcStroke={0.5}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={4000}
      />
    </div>
  );
}
