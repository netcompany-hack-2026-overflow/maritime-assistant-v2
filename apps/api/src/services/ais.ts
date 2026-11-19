import WebSocket from "ws";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { getSeaRoute } from "./seaRoute.js";
import { recomputeVoyage } from "./scenarios.js";

/**
 * Live AIS from aisstream.io (https://aisstream.io/documentation).
 *
 * One WebSocket subscribed to the MMSIs of the vessels linked in the UI. Each
 * PositionReport updates the vessel's last fix; at most every
 * AIS_RECOMPUTE_MINUTES per vessel the voyage ETA is re-derived from the live
 * position and speed and its pending scenarios are recomputed. The API key
 * comes from AISSTREAM_API_KEY (.env) and never leaves the server.
 */

const URL = "wss://stream.aisstream.io/v0/stream";
const DB_WRITE_MIN_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export interface AisPositionReport {
  mmsi: string;
  lat: number;
  lon: number;
  sogKn: number;
  cogDeg: number;
  at: Date;
}

/** Parse an aisstream.io message; null for anything that is not a usable position. */
export function parseAisMessage(raw: unknown): AisPositionReport | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as {
    MessageType?: string;
    MetaData?: Record<string, unknown>;
    Message?: { PositionReport?: Record<string, unknown> };
  };
  if (m.MessageType !== "PositionReport") return null;
  const p = m.Message?.PositionReport ?? {};
  const meta = m.MetaData ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lat = num(p.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
  const lon = num(p.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
  const mmsi = meta.MMSI ?? p.UserID;
  if (lat == null || lon == null || mmsi == null) return null;
  // 91/181 are the AIS "not available" values.
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const sog = num(p.Sog);
  const cog = num(p.Cog);
  const heading = num(p.TrueHeading);
  const timeText = typeof meta.time_utc === "string" ? meta.time_utc.replace(/ \+0000 UTC$/, "Z").replace(" ", "T") : null;
  const parsedTime = timeText ? new Date(timeText) : null;
  return {
    mmsi: String(mmsi),
    lat,
    lon,
    // 102.3 kn = not available
    sogKn: sog != null && sog < 102 ? sog : 0,
    cogDeg: cog != null && cog < 360 ? cog : heading != null && heading < 360 ? heading : 0,
    at: parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : new Date(),
  };
}

export interface AisStatus {
  enabled: boolean;
  connected: boolean;
  trackedMmsi: string[];
  messagesReceived: number;
  lastMessageAt: string | null;
  lastError: string | null;
}

class AisTracker {
  private ws: WebSocket | null = null;
  private mmsiToVessel = new Map<string, string>();
  private lastWrite = new Map<string, number>();
  private lastRecompute = new Map<string, number>();
  private backoff = 2_000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state = { connected: false, messages: 0, lastAt: null as Date | null, error: null as string | null };

  status(): AisStatus {
    return {
      enabled: !!env.aisApiKey,
      connected: this.state.connected,
      trackedMmsi: [...this.mmsiToVessel.keys()],
      messagesReceived: this.state.messages,
      lastMessageAt: this.state.lastAt?.toISOString() ?? null,
      lastError: this.state.error,
    };
  }

  /** (Re)subscribe to the currently linked vessels. Safe to call any time. */
  async refresh(): Promise<void> {
    if (!env.aisApiKey) return;
    const vessels = await prisma.vessel.findMany({ where: { mmsi: { not: null } }, select: { id: true, mmsi: true } });
    this.mmsiToVessel = new Map(vessels.map((v) => [v.mmsi!, v.id]));
    this.close();
    // Linking a vessel after stop() updates the list but doesn't reconnect.
    if (!this.stopped && this.mmsiToVessel.size > 0) this.connect();
  }

  start(): void {
    this.stopped = false;
    this.refresh().catch((err) => {
      this.state.error = (err as Error).message;
    });
  }

  stop(): void {
    this.stopped = true;
    this.close();
  }

  private close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on("error", () => {});
      this.ws.close();
      this.ws = null;
    }
    this.state.connected = false;
  }

  private connect() {
    const ws = new WebSocket(URL);
    this.ws = ws;
    let gotData = false;
    ws.on("open", () => {
      // Must arrive within 3 s of connecting.
      ws.send(
        JSON.stringify({
          APIKey: env.aisApiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: [...this.mmsiToVessel.keys()].slice(0, 50),
          FilterMessageTypes: ["PositionReport"],
        })
      );
      this.state.connected = true;
      this.state.error = null;
      this.backoff = 2_000;
    });
    ws.on("message", (data) => {
      gotData = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      const err = (parsed as { error?: string }).error;
      if (err) {
        this.state.error = err;
        return;
      }
      const report = parseAisMessage(parsed);
      if (report) this.onReport(report).catch((e) => (this.state.error = (e as Error).message));
    });
    ws.on("error", (err) => {
      this.state.error = err.message;
    });
    ws.on("close", (code) => {
      this.state.connected = false;
      // aisstream.io drops an invalid key without a message (code 1006).
      if (!gotData && !this.state.error) {
        this.state.error = `aisstream.io closed the connection (code ${code}) before sending data; check AISSTREAM_API_KEY`;
      }
      if (this.stopped || this.ws !== ws) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    });
  }

  private async onReport(r: AisPositionReport) {
    const vesselId = this.mmsiToVessel.get(r.mmsi);
    if (!vesselId) return;
    this.state.messages++;
    this.state.lastAt = new Date();

    const now = Date.now();
    if (now - (this.lastWrite.get(vesselId) ?? 0) < DB_WRITE_MIN_MS) return;
    this.lastWrite.set(vesselId, now);
    await prisma.vessel.update({
      where: { id: vesselId },
      data: { aisLat: r.lat, aisLon: r.lon, aisSogKn: r.sogKn, aisCogDeg: r.cogDeg, aisAt: r.at },
    });

    if (now - (this.lastRecompute.get(vesselId) ?? 0) < env.aisRecomputeMinutes * 60_000) return;
    this.lastRecompute.set(vesselId, now);
    await applyLiveFix(vesselId, r);
  }
}

/**
 * Live ETA = sea-route distance from the AIS position to the destination at
 * the reported speed over ground. Pending scenarios for the voyage are then
 * recomputed (without a new LLM rationale unless the best scenario changes).
 */
export async function applyLiveFix(vesselId: string, r: Pick<AisPositionReport, "lat" | "lon" | "sogKn">) {
  const voyage = await prisma.voyage.findFirst({
    where: { vesselId, status: "UNDERWAY" },
    include: { destPort: true },
  });
  if (!voyage) return null;
  if (r.sogKn >= 1) {
    const ahead = getSeaRoute({ lat: r.lat, lon: r.lon }, { lat: voyage.destPort.lat, lon: voyage.destPort.lon });
    const eta = new Date(Date.now() + (ahead.lengthNm / r.sogKn) * 3_600_000);
    await prisma.voyage.update({ where: { id: voyage.id }, data: { plannedEta: eta } });
    await prisma.auditLog.create({
      data: {
        entity: "voyage",
        entityId: voyage.id,
        action: "LIVE_ETA_UPDATED",
        payload: { source: "ais", lat: r.lat, lon: r.lon, sogKn: r.sogKn, remainingNm: ahead.lengthNm, eta: eta.toISOString() },
      },
    });
  }
  return recomputeVoyage(voyage.id, { withRationale: false });
}

export const aisTracker = new AisTracker();
