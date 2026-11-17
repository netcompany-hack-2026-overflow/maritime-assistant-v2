import { describe, expect, it } from "vitest";
import { simHoursSince } from "../positions.js";

describe("simHoursSince", () => {
  it("converts 1 real second at SIM_SPEED=120 into 2 sim minutes", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const now = new Date(since.getTime() + 1000);
    const hours = simHoursSince(since, 120, now);
    expect(hours).toBeCloseTo(2 / 60, 6);
  });

  it("scales linearly with SIM_SPEED", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const now = new Date(since.getTime() + 10_000);
    expect(simHoursSince(since, 240, now)).toBeCloseTo(
      2 * simHoursSince(since, 120, now),
      6
    );
  });
});
