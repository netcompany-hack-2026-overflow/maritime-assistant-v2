import { interpolateAlongPolyline, polylineLengthNm, type LatLon, type RouteWeather } from "@maritime/shared";
import { env } from "../lib/env.js";

/**
 * Weather along the remaining route, from the Open-Meteo Marine API
 * (https://open-meteo.com/en/docs/marine-weather-api: significant wave height
 * and ocean surface current, hourly, no API key). Each sample point is read at
 * the hour the ship is expected to pass it. When the API is unreachable, or
 * WEATHER_PROVIDER=mock, a deterministic mock stands in and says so.
 */

export interface WeatherSample {
  lat: number;
  lon: number;
  at: string;
  /** Ship's heading at this point, degrees true. */
  headingDeg: number;
  waveM: number | null;
  currentKn: number | null;
  /** Direction the current flows towards, degrees true. */
  currentDirDeg: number | null;
}

export interface RouteWeatherDetail extends RouteWeather {
  samples: WeatherSample[];
}

const SAMPLE_COUNT = 12;
const KMH_PER_KN = 1.852;
const CACHE_MS = 30 * 60_000;
const H = 3_600_000;

/**
 * Added resistance in waves as a multiplier on daily fuel: 1 + 0.012·Hs², capped.
 * Hs 2 m → +5 %, 3 m → +11 %, 4 m → +19 %, 5 m → +30 %. A simple, documented
 * proxy (README "Assumptions"), not a vessel-specific seakeeping model.
 */
export function seaStateFactor(waveM: number): number {
  return Math.min(1.35, 1 + 0.012 * waveM * waveM);
}

/** Component of the current against the ship's heading (+ = adverse), kn. */
export function headCurrentComponent(currentKn: number, currentDirDeg: number, headingDeg: number): number {
  return -currentKn * Math.cos(((currentDirDeg - headingDeg) * Math.PI) / 180);
}

/** Points spread along the route with the time the ship reaches each one. */
export function samplePoints(
  route: LatLon[],
  startAt: Date,
  legNm: number,
  speedKn: number,
  count = SAMPLE_COUNT
): Array<{ position: LatLon; heading: number; at: Date }> {
  if (route.length < 2) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const f = (i + 0.5) / count;
    const { position, heading } = interpolateAlongPolyline(route, f);
    const hours = speedKn > 0 ? (f * legNm) / speedKn : 0;
    out.push({ position, heading, at: new Date(startAt.getTime() + hours * H) });
  }
  return out;
}

export function summarise(samples: WeatherSample[], source: RouteWeather["source"]): RouteWeatherDetail {
  const waves = samples.map((s) => s.waveM).filter((v): v is number => v != null);
  const heads = samples
    .filter((s) => s.currentKn != null && s.currentDirDeg != null)
    .map((s) => headCurrentComponent(s.currentKn!, s.currentDirDeg!, s.headingDeg));
  const meanWaveM = waves.length ? waves.reduce((a, b) => a + b, 0) / waves.length : null;
  const maxWaveM = waves.length ? Math.max(...waves) : null;
  const headCurrentKn = heads.length ? heads.reduce((a, b) => a + b, 0) / heads.length : 0;
  const seaStateFuelFactor = waves.length
    ? waves.reduce((a, w) => a + seaStateFactor(w), 0) / waves.length
    : 1;
  const current =
    Math.abs(headCurrentKn) < 0.05
      ? "no net current"
      : `${Math.abs(headCurrentKn).toFixed(1)} kn ${headCurrentKn > 0 ? "adverse" : "following"} current`;
  const waveText =
    meanWaveM == null ? "waves unknown" : `waves ${meanWaveM.toFixed(1)} m mean / ${maxWaveM!.toFixed(1)} m max`;
  return {
    headCurrentKn: Math.round(headCurrentKn * 100) / 100,
    seaStateFuelFactor: Math.round(seaStateFuelFactor * 1000) / 1000,
    meanWaveM,
    maxWaveM,
    description: `${waveText}, ${current}`,
    source,
    samples,
  };
}

// ---------- mock ----------

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic weather per 2°×2° cell and day: waves 0.5–5 m, current 0–1.5 kn. */
export function mockSample(position: LatLon, heading: number, at: Date): WeatherSample {
  const cell = `${Math.floor(position.lat / 2)}:${Math.floor(position.lon / 2)}:${at.toISOString().slice(0, 10)}`;
  const h = hash(cell);
  return {
    lat: position.lat,
    lon: position.lon,
    at: at.toISOString(),
    headingDeg: heading,
    waveM: 0.5 + (h % 46) / 10,
    currentKn: ((h >>> 6) % 16) / 10,
    currentDirDeg: (h >>> 12) % 360,
  };
}

// ---------- Open-Meteo ----------

interface OpenMeteoLocation {
  hourly?: {
    time: string[];
    wave_height?: (number | null)[];
    ocean_current_velocity?: (number | null)[];
    ocean_current_direction?: (number | null)[];
  };
}

const cache = new Map<string, { at: number; data: OpenMeteoLocation[] }>();

async function fetchOpenMeteo(points: LatLon[]): Promise<OpenMeteoLocation[]> {
  const lat = points.map((p) => p.lat.toFixed(2)).join(",");
  const lon = points.map((p) => p.lon.toFixed(2)).join(",");
  const url =
    "https://marine-api.open-meteo.com/v1/marine" +
    `?latitude=${lat}&longitude=${lon}` +
    "&hourly=wave_height,ocean_current_velocity,ocean_current_direction" +
    "&timezone=GMT&forecast_days=8&cell_selection=sea";
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const res = await fetch(url, { signal: AbortSignal.timeout(env.weatherTimeoutMs) });
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  const body = (await res.json()) as OpenMeteoLocation | OpenMeteoLocation[];
  const data = Array.isArray(body) ? body : [body];
  if (data.length !== points.length) throw new Error("Open-Meteo returned an unexpected number of locations");
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** Value of an hourly series at the hour nearest `at` (clamped to the forecast range). */
export function valueAt(times: string[], values: (number | null)[] | undefined, at: Date): number | null {
  if (!values || times.length === 0) return null;
  const t0 = Date.parse(`${times[0]}Z`);
  const idx = Math.max(0, Math.min(times.length - 1, Math.round((at.getTime() - t0) / H)));
  const v = values[idx];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

let lastError: string | null = null;

/** Last Open-Meteo failure (shown in Settings), or null. */
export function lastWeatherError(): string | null {
  return lastError;
}

/**
 * Weather for a route ahead. `legNm` is the remaining distance on the
 * operational timeline (used to time each sample); `route` is the geometry.
 */
export async function routeWeather(
  route: LatLon[],
  startAt: Date,
  speedKn: number,
  legNm: number = polylineLengthNm(route)
): Promise<RouteWeatherDetail> {
  const points = samplePoints(route, startAt, legNm, speedKn);
  if (points.length === 0) return summarise([], "mock");

  if (env.weatherProvider !== "mock") {
    try {
      const data = await fetchOpenMeteo(points.map((p) => p.position));
      const samples = points.map((p, i): WeatherSample => {
        const hourly = data[i].hourly;
        const times = hourly?.time ?? [];
        const kmh = valueAt(times, hourly?.ocean_current_velocity, p.at);
        return {
          lat: p.position.lat,
          lon: p.position.lon,
          at: p.at.toISOString(),
          headingDeg: p.heading,
          waveM: valueAt(times, hourly?.wave_height, p.at),
          currentKn: kmh == null ? null : kmh / KMH_PER_KN,
          currentDirDeg: valueAt(times, hourly?.ocean_current_direction, p.at),
        };
      });
      lastError = null;
      return summarise(samples, "open-meteo");
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`Open-Meteo unavailable, using mock weather: ${lastError}`);
    }
  }
  return summarise(points.map((p) => mockSample(p.position, p.heading, p.at)), "mock");
}
