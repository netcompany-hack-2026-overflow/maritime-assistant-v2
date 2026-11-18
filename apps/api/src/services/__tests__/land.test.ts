import { describe, expect, it } from "vitest";
import { crossesLand, isOnLand } from "../land.js";

const ALGECIRAS = { lat: 36.1246, lon: -5.4418 };
const GENOA = { lat: 44.4056, lon: 8.9463 };

describe("land check", () => {
  it("knows land from sea", () => {
    expect(isOnLand({ lat: 46.5, lon: 2.5 })).toBe(true); // central France
    expect(isOnLand({ lat: 38, lon: 5 })).toBe(false); // western Med
  });

  it("a short hop across the Strait to Algeciras is open water", () => {
    expect(crossesLand({ lat: 35.965, lon: -5.43 }, ALGECIRAS)).toBe(false);
  });

  it("Rotterdam approaches to Genoa cross the continent", () => {
    expect(crossesLand({ lat: 51.5, lon: 3.4 }, GENOA)).toBe(true);
  });
});
