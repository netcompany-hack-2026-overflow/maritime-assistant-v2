import type { BunkerPlan, LatLon } from "@maritime/shared";

interface RouteSketchProps {
  plan: BunkerPlan;
  portName: string;
}

/**
 * A close-up of where the route changes: the planned track in grey, the
 * detour to the bunker port and back in blue. Flat projection around the
 * turn-off point, which is accurate at this scale (tens of miles).
 */
export function RouteSketch({ plan, portName }: RouteSketchProps) {
  const { turnOff, bunkerPort, shipPosition, offRouteNm } = plan.input;
  const lat0 = (turnOff.lat + bunkerPort.lat) / 2;
  const lon0 = (turnOff.lon + bunkerPort.lon) / 2;
  const k = Math.cos((lat0 * Math.PI) / 180);
  // Half the window, in degrees of latitude (1° = 60 nm).
  const half = Math.max(offRouteNm * 1.8, 30) / 60;
  const xy = (p: LatLon) => ({ x: (p.lon - lon0) * k, y: -(p.lat - lat0) });
  const pts = (line: LatLon[]) =>
    line
      .map(xy)
      .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)
      .join(" ");
  const inView = (p: LatLon) => {
    const q = xy(p);
    return Math.abs(q.x) < half && Math.abs(q.y) < half;
  };
  const port = xy(bunkerPort);
  const turn = xy(turnOff);
  const ship = xy(shipPosition);
  const r = half / 28;
  const font = half / 9;

  return (
    <svg
      className="route-sketch"
      viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Route change: leave the planned track ${offRouteNm.toFixed(0)} nm from ${portName}, call there, and rejoin at the same point.`}
    >
      <polyline className="route-sketch__track" points={pts(plan.route.before)} vectorEffect="non-scaling-stroke" />
      <polyline className="route-sketch__track route-sketch__track--ahead" points={pts(plan.route.after)} vectorEffect="non-scaling-stroke" />
      <line className="route-sketch__detour" x1={turn.x} y1={turn.y} x2={port.x} y2={port.y} vectorEffect="non-scaling-stroke" />
      <circle className="route-sketch__turn" cx={turn.x} cy={turn.y} r={r} />
      <circle className="route-sketch__port" cx={port.x} cy={port.y} r={r * 1.4} />
      <text className="route-sketch__label" x={port.x + r * 2} y={port.y + font / 3} fontSize={font}>
        {portName}
      </text>
      {inView(shipPosition) && (
        <>
          <circle className="route-sketch__ship" cx={ship.x} cy={ship.y} r={r} />
          <text className="route-sketch__label" x={ship.x + r * 2} y={ship.y + font / 3} fontSize={font}>
            Ship
          </text>
        </>
      )}
    </svg>
  );
}
