import { describe, expect, it } from "vitest";
import { haversineNm, interpolateAlongPolyline, polylineLengthNm } from "../geo.js";

// An "L" around a corner: east along the equator, then north.
const L = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 10 },
  { lat: 10, lon: 10 },
];

describe("polylineLengthNm", () => {
  it("sums the legs", () => {
    const expected = haversineNm(L[0], L[1]) + haversineNm(L[1], L[2]);
    expect(polylineLengthNm(L)).toBeCloseTo(expected, 6);
  });

  it("is 0 for a single point", () => {
    expect(polylineLengthNm([{ lat: 1, lon: 1 }])).toBe(0);
  });
});

describe("interpolateAlongPolyline", () => {
  it("returns the endpoints at 0 and 1", () => {
    expect(interpolateAlongPolyline(L, 0).position).toEqual({ lat: 0, lon: 0 });
    const end = interpolateAlongPolyline(L, 1).position;
    expect(end.lat).toBeCloseTo(10, 6);
    expect(end.lon).toBeCloseTo(10, 6);
  });

  it("follows the corner instead of cutting across it", () => {
    // halfway by distance is the corner vertex itself (legs are equal length)
    const mid = interpolateAlongPolyline(L, 0.5);
    expect(mid.position.lat).toBeCloseTo(0, 4);
    expect(mid.position.lon).toBeCloseTo(10, 4);

    const q = interpolateAlongPolyline(L, 0.25);
    expect(q.position.lat).toBeCloseTo(0, 6);
    expect(q.position.lon).toBeCloseTo(5, 4);
    expect(q.heading).toBeCloseTo(90, 0); // heading east on leg 1
    expect(q.nextIndex).toBe(1);

    const tq = interpolateAlongPolyline(L, 0.75);
    expect(tq.position.lon).toBeCloseTo(10, 4);
    expect(tq.heading).toBeCloseTo(0, 0); // heading north on leg 2
    expect(tq.nextIndex).toBe(2);
  });

  it("clamps fractions outside 0..1", () => {
    expect(interpolateAlongPolyline(L, -1).position).toEqual({ lat: 0, lon: 0 });
    expect(interpolateAlongPolyline(L, 2).position.lat).toBeCloseTo(10, 6);
  });
});
