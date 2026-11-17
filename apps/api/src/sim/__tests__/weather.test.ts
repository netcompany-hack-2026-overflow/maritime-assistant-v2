import { describe, expect, it } from "vitest";
import { mockWeatherFor } from "../weather.js";

describe("mockWeatherFor", () => {
  it("is deterministic for the same port and day", () => {
    const a = mockWeatherFor("NLRTM", new Date("2026-11-20T03:00:00Z"));
    const b = mockWeatherFor("NLRTM", new Date("2026-11-20T21:00:00Z"));
    expect(a).toEqual(b);
  });

  it("stays within the documented ranges", () => {
    for (const port of ["NLRTM", "ESALG", "SGSIN", "USHOU", "GRPIR"]) {
      for (let d = 1; d <= 30; d++) {
        const w = mockWeatherFor(port, new Date(Date.UTC(2026, 10, d)));
        expect(w.headCurrentKn).toBeGreaterThanOrEqual(-0.5);
        expect(w.headCurrentKn).toBeLessThanOrEqual(1.5);
        expect(w.seaStateFuelFactor).toBeGreaterThanOrEqual(1);
        expect(w.seaStateFuelFactor).toBeLessThanOrEqual(1.1);
        expect(w.description).toMatch(/sea/);
      }
    }
  });
});
