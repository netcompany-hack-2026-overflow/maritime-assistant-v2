import type { JitWeather } from "@maritime/shared";

/**
 * Mock weather along a voyage's final approach. Deterministic per destination
 * port and calendar day, so the demo is reproducible and a judge sees the same
 * numbers on a re-run. A real deployment would query a marine-weather API
 * (current and significant wave height) for the remaining route instead.
 */
export interface MockWeather extends JitWeather {
  description: string;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SEA_STATES = [
  { factor: 1.0, name: "ήρεμη θάλασσα" },
  { factor: 1.03, name: "λίγο κύμα" },
  { factor: 1.06, name: "μέτριο κύμα" },
  { factor: 1.1, name: "θαλασσοταραχή" },
];

export function mockWeatherFor(destUnlocode: string, at: Date): MockWeather {
  const day = at.toISOString().slice(0, 10);
  const h = hash(`${destUnlocode}:${day}`);
  // current between -0.5 kn (following) and +1.5 kn (adverse), 0.1 kn steps
  const headCurrentKn = Math.round(((h % 21) - 5) / 10 * 10) / 10;
  const sea = SEA_STATES[(h >>> 8) % SEA_STATES.length];
  const currentText =
    headCurrentKn > 0
      ? `${headCurrentKn.toFixed(1)} kn αντίθετο ρεύμα`
      : headCurrentKn < 0
        ? `${Math.abs(headCurrentKn).toFixed(1)} kn ευνοϊκό ρεύμα`
        : "χωρίς ρεύμα";
  return {
    headCurrentKn,
    seaStateFuelFactor: sea.factor,
    description: `${sea.name}, ${currentText}`,
  };
}
