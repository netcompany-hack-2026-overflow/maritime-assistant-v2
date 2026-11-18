import { describe, expect, it, vi } from "vitest";
import { polylineLengthNm, type LatLon } from "@maritime/shared";

// Weather along candidate routes: calm wherever we are asked (the planned
// track's rough patch is in `base` below), so any open-water detour scores.
vi.mock("../weather.js", () => ({
  routeWeather: async (coords: LatLon[]) => ({
    headCurrentKn: 0,
    seaStateFuelFactor: 1,
    meanWaveM: 1,
    maxWaveM: 1,
    description: "calm",
    source: "mock",
    samples: coords.map((c) => ({ ...c, at: "", headingDeg: 0, waveM: 1, currentKn: 0, currentDirDeg: 0 })),
  }),
}));

const { findWeatherRoute } = await import("../weatherRoute.js");

function base(route: LatLon[], roughIndex: number) {
  const samples = Array.from({ length: 12 }, (_, i) => {
    const f = (i + 0.5) / 12;
    const lat = route[0].lat + f * (route[route.length - 1].lat - route[0].lat);
    return { lat, lon: route[0].lon, at: "", headingDeg: 0, waveM: i === roughIndex ? 6 : 1.5, currentKn: 0, currentDirDeg: 0 };
  });
  return {
    headCurrentKn: 0,
    seaStateFuelFactor: 1.2,
    meanWaveM: 2,
    maxWaveM: 6,
    description: "rough",
    source: "mock" as const,
    samples,
  };
}

describe("findWeatherRoute", () => {
  it("swaps only the rough stretch for a short open-water detour", async () => {
    // Open Atlantic, due north along 25°W.
    const ahead: LatLon[] = [
      { lat: 35, lon: -25 },
      { lat: 40, lon: -25 },
      { lat: 45, lon: -25 },
    ];
    const r = await findWeatherRoute({
      ahead,
      base: base(ahead, 6),
      legNm: polylineLengthNm(ahead),
      startAt: new Date("2026-11-18T00:00:00Z"),
      hoursAvailable: 60,
      speedKn: 14,
    });
    expect(r).not.toBeNull();
    const len = polylineLengthNm(r!.coords!);
    expect(len).toBeGreaterThan(polylineLengthNm(ahead));
    expect(len).toBeLessThan(polylineLengthNm(ahead) * 1.3);
    // Starts and ends where the planned route does.
    expect(r!.coords![0]).toEqual(ahead[0]);
    expect(r!.coords![r!.coords!.length - 1]).toEqual(ahead[2]);
    expect(r!.via).toMatch(/^via .*\(\+\d+ nm, around 6\.0 m seas/);
  });

  it("offers nothing on a leg too short to re-route", async () => {
    const ahead: LatLon[] = [
      { lat: 40, lon: -25 },
      { lat: 41, lon: -25 },
    ];
    const r = await findWeatherRoute({
      ahead,
      base: base(ahead, 3),
      legNm: polylineLengthNm(ahead),
      startAt: new Date(),
      hoursAvailable: 10,
      speedKn: 14,
    });
    expect(r).toBeNull();
  });
});
