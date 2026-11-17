import { describe, expect, it } from "vitest";
import { haversineNm, initialBearing, greatCircleInterpolate } from "../geo.js";

describe("haversineNm", () => {
  it("returns ~0 for identical points", () => {
    const p = { lat: 37.94, lon: 23.65 };
    expect(haversineNm(p, p)).toBeCloseTo(0, 5);
  });

  it("matches the known Piraeus -> Rotterdam great-circle distance", () => {
    const piraeus = { lat: 37.9475, lon: 23.6367 };
    const rotterdam = { lat: 51.9496, lon: 4.1453 };
    const nm = haversineNm(piraeus, rotterdam);
    // Great-circle (straight-line) distance is ~1150-1200 nm; this ignores
    // coastlines, so it is shorter than the real sea route via Gibraltar.
    expect(nm).toBeGreaterThan(1100);
    expect(nm).toBeLessThan(1250);
  });
});

describe("initialBearing", () => {
  it("is ~0 degrees sailing due north", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 10, lon: 0 };
    expect(initialBearing(a, b)).toBeCloseTo(0, 1);
  });

  it("is ~90 degrees sailing due east along the equator", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 10 };
    expect(initialBearing(a, b)).toBeCloseTo(90, 1);
  });
});

describe("greatCircleInterpolate", () => {
  const a = { lat: 37.9475, lon: 23.6367 };
  const b = { lat: 51.9496, lon: 4.1453 };

  it("returns the origin at fraction 0", () => {
    const p = greatCircleInterpolate(a, b, 0);
    expect(p.lat).toBeCloseTo(a.lat, 5);
    expect(p.lon).toBeCloseTo(a.lon, 5);
  });

  it("returns the destination at fraction 1", () => {
    const p = greatCircleInterpolate(a, b, 1);
    expect(p.lat).toBeCloseTo(b.lat, 5);
    expect(p.lon).toBeCloseTo(b.lon, 5);
  });

  it("is monotonically closer to destination as fraction increases", () => {
    const mid = greatCircleInterpolate(a, b, 0.5);
    const distAtMidToB = haversineNm(mid, b);
    const distAtStartToB = haversineNm(a, b);
    expect(distAtMidToB).toBeLessThan(distAtStartToB);
  });
});
