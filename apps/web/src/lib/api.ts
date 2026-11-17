import type { PortDTO, VesselPositionDTO, VoyageStatus } from "@maritime/shared";

export interface MetaResponse {
  llmProvider: "mock" | "anthropic" | "openai";
  simSpeed: number;
  fuelPriceEurPerT: number;
  co2Factor: number;
}

export interface VesselListItem {
  id: string;
  imo: string;
  name: string;
  type: string;
  dwt: number;
  designSpeedKn: number;
  minSpeedKn: number;
  fuelTPerDayAtDesign: number;
  auxFuelTPerDay: number;
  status: VoyageStatus | "IDLE";
  speedKn: number | null;
  destPort: string | null;
  originPort: string | null;
  voyageId: string | null;
}

export interface VoyageListItem {
  id: string;
  vesselId: string;
  vesselName: string;
  vesselImo: string;
  vesselType: string;
  originPortId: string;
  originPortName: string;
  destPortId: string;
  destPortName: string;
  departedAt: string;
  speedKn: number;
  sailedNmAtRebase: number;
  rebasedAt: string;
  plannedEta: string;
  berthTime: string | null;
  status: VoyageStatus;
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  getMeta: () => request<MetaResponse>("/meta"),
  getPorts: () => request<PortDTO[]>("/ports"),
  getVessels: () => request<VesselListItem[]>("/vessels"),
  getVesselPositions: () => request<VesselPositionDTO[]>("/vessels/positions"),
  getVoyages: () => request<VoyageListItem[]>("/voyages"),
};
