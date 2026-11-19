import { describe, expect, it } from "vitest";
import {
  assessWarRisk,
  compareWarRisk,
  coverPeriods,
  crewBonusDays,
  crewZoneAt,
  jwcZoneAt,
  listedCountry,
  WAR_COVER_PERIOD_DAYS,
} from "../warRisk.js";
import type { LatLon } from "../geo.js";

const at = (lat: number, lon: number): LatLon => ({ lat, lon });
const zoneId = (lat: number, lon: number) => jwcZoneAt(at(lat, lon))?.zone.id ?? null;

/** Port Said → Jebel Ali, the vertices searoute-js gives for Genoa → Jebel Ali. */
const SUEZ_TO_JEBEL_ALI: LatLon[] = [
  [31.7, 32.1], [31.0, 32.17], [30.95, 32.17], [29.7, 32.6], [27.9, 33.75], [27.0, 34.5], [23.6, 37.0],
  [20.75, 38.9], [16.3, 41.2], [15.0, 42.0], [12.7, 43.3], [12.0, 45.0], [14.14, 49.56], [16.2, 54.2],
  [20.0, 59.0], [22.7, 60.4], [24.0, 59.0], [25.5, 57.1], [26.4, 56.4], [25.6, 55.2], [25.0118, 55.0618],
].map(([lat, lon]) => at(lat, lon));

/** Port Said → past Sri Lanka, the Suez leg of Hamburg/Antwerp → Asia. */
const SUEZ_TO_COLOMBO: LatLon[] = [
  [31.7, 32.1], [30.95, 32.17], [29.7, 32.6], [27.9, 33.75], [27.0, 34.5], [23.6, 37.0], [20.75, 38.9],
  [16.3, 41.2], [15.0, 42.0], [12.7, 43.3], [12.0, 45.0], [13.0, 51.0], [12.24, 54.71], [11.43, 58.4],
  [10.58, 62.06], [9.69, 65.7], [8.76, 69.33], [6.5, 79.5],
].map(([lat, lon]) => at(lat, lon));

const NOW = new Date("2026-11-19T12:00:00Z");
const base = { speedKn: 14.5, sailedNm: 0, now: NOW, hullValueUsd: 40_000_000, destPortStayHours: 48 };

describe("JWC listed areas (JWLA-035)", () => {
  it("puts known places in the right zone", () => {
    expect(zoneId(12.78, 44.98)).toBe("RED_SEA_ADEN"); // Aden
    expect(zoneId(21.48, 39.1)).toBe("RED_SEA_ADEN"); // off Jeddah, south of 25.5°N
    expect(zoneId(12.6, 43.4)).toBe("RED_SEA_ADEN"); // Bab el-Mandeb
    expect(zoneId(26.57, 56.25)).toBe("GULF_HORMUZ"); // Strait of Hormuz
    expect(zoneId(25.01, 55.0)).toBe("GULF_HORMUZ"); // off Jebel Ali
    expect(zoneId(29.3, 48.2)).toBe("GULF_HORMUZ"); // off Kuwait
    expect(zoneId(23.7, 58.7)).toBe("GULF_HORMUZ"); // off Muscat
    expect(zoneId(12.24, 54.71)).toBe("INDIAN_OCEAN_W"); // east of Socotra
    expect(zoneId(2.0, 47.0)).toBe("INDIAN_OCEAN_W"); // off Mogadishu
    expect(zoneId(6.3, 3.4)).toBe("GULF_OF_GUINEA"); // off Lagos
    expect(zoneId(0.3, 6.7)).toBe("GULF_OF_GUINEA"); // São Tomé
    expect(zoneId(43.5, 34.0)).toBe("BLACK_SEA");
    expect(zoneId(46.0, 37.0)).toBe("BLACK_SEA"); // Sea of Azov
    expect(zoneId(-12.9, 40.7)).toBe("CABO_DELGADO"); // off Pemba
  });

  it("leaves waters outside the list alone", () => {
    expect(zoneId(29.95, 32.55)).toBeNull(); // Suez
    expect(zoneId(27.5, 34.0)).toBeNull(); // northern Red Sea, above 25.5°N
    expect(zoneId(29.3, 34.9)).toBeNull(); // Gulf of Aqaba
    expect(zoneId(18.9, 72.6)).toBeNull(); // Mumbai
    expect(zoneId(24.7, 66.9)).toBeNull(); // Karachi, east of 65°E
    expect(zoneId(-4.62, 55.45)).toBeNull(); // Seychelles
    expect(zoneId(-4.05, 39.75)).toBeNull(); // Mombasa
    expect(zoneId(5.25, -4.0)).toBeNull(); // Abidjan, west of the Togo line
    expect(zoneId(40.8, 28.5)).toBeNull(); // Sea of Marmara
    expect(zoneId(35.0, 25.0)).toBeNull(); // Mediterranean
    expect(zoneId(1.26, 103.8)).toBeNull(); // Singapore
  });

  it("reads listed countries by name and alias", () => {
    expect(listedCountry("United Arab Emirates")?.label).toBe("Ηνωμένα Αραβικά Εμιράτα");
    expect(listedCountry("UAE")?.key).toBe("united arab emirates");
    expect(listedCountry("Russian Federation")?.rate.pct).toBe(0.7);
    expect(listedCountry("Greece")).toBeNull();
  });
});

describe("IBF crew zones", () => {
  it("knows the warlike areas and the zones around them", () => {
    expect(crewZoneAt(at(12.78, 44.98))?.category).toBe("WOA"); // Aden
    expect(crewZoneAt(at(21.48, 39.1))).toBeNull(); // Jeddah: north of 16°24'N
    expect(crewZoneAt(at(26.57, 56.25))?.id).toBe("GULF_HORMUZ_WOA");
    expect(crewZoneAt(at(23.7, 58.7))?.id).toBe("GULF_OMAN_ERZ");
    expect(crewZoneAt(at(32.8, 34.9))?.id).toBe("ISRAEL_LEBANON_ERZ"); // off Haifa
  });

  it("pays at least 5 days in a WOA, actual days in an HRA, nothing planned in an ERZ", () => {
    expect(crewBonusDays("WOA", 1.2)).toBe(5);
    expect(crewBonusDays("WOA", 6.1)).toBe(7);
    expect(crewBonusDays("HRA", 1.2)).toBe(2);
    expect(crewBonusDays("ERZ", 3)).toBe(0);
    expect(crewBonusDays("ERZ", 3, 2.5)).toBe(3); // Level 2: days alongside
  });
});

describe("cover periods", () => {
  it("buys 7-day periods, at least one", () => {
    expect(WAR_COVER_PERIOD_DAYS).toBe(7);
    expect(coverPeriods(0.3)).toBe(1);
    expect(coverPeriods(7)).toBe(1);
    expect(coverPeriods(7.01)).toBe(2);
    expect(coverPeriods(14.5)).toBe(3);
  });
});

describe("assessWarRisk", () => {
  it("prices the Red Sea → Hormuz → Jebel Ali voyage at the Hormuz rate, for every 7 days inside", () => {
    const a = assessWarRisk({ ...base, route: SUEZ_TO_JEBEL_ALI, destCountry: "United Arab Emirates" });
    expect(a.exposures).toHaveLength(1); // the UAE call sits inside the defined waters: no second charge
    const e = a.exposures[0];
    expect(e.areaId).toBe("INDIAN_OCEAN");
    expect(e.zones.map((z) => z.zoneId)).toEqual(["RED_SEA_ADEN", "INDIAN_OCEAN_W", "GULF_HORMUZ"]);
    expect(e.rateZoneId).toBe("GULF_HORMUZ");
    expect(e.ratePct).toBe(3);
    expect(e.endsInside).toBe(true);
    expect(e.portStayDays).toBe(2);
    expect(e.daysInArea).toBeGreaterThan(WAR_COVER_PERIOD_DAYS);
    expect(e.periods).toBe(coverPeriods(e.daysInArea));
    expect(e.premiumUsd).toBe(Math.round(40_000_000 * 0.03 * e.periods));
    expect(e.status).toBe("AHEAD");
    expect(e.enterPosition.lat).toBeCloseTo(25.5, 0);
    expect(a.notifyBy).toBe(e.enterAt);
    expect(a.kidnapAndRansomAdvised).toBe(true); // Gulf of Aden piracy
    expect(a.crew.map((c) => c.zoneId)).toEqual(["RED_SEA_ADEN_WOA", "GULF_OMAN_ERZ", "GULF_HORMUZ_WOA"]);
    expect(a.crew.find((c) => c.zoneId === "GULF_OMAN_ERZ")?.bonusUsd).toBe(0);
    expect(a.totals.premiumUsd).toBe(e.premiumUsd);
  });

  it("uses the broker's quote instead of the market figure", () => {
    const a = assessWarRisk({ ...base, route: SUEZ_TO_JEBEL_ALI, quotedPct: { GULF_HORMUZ: 2.25 } });
    const e = a.exposures[0];
    expect(e.ratePct).toBe(2.25);
    expect(e.quoted).toBe(true);
  });

  it("slower speed means more days in the area and more periods", () => {
    const fast = assessWarRisk({ ...base, route: SUEZ_TO_COLOMBO, speedKn: 16, destPortStayHours: 0 });
    const slow = assessWarRisk({ ...base, route: SUEZ_TO_COLOMBO, speedKn: 9, destPortStayHours: 0 });
    expect(fast.exposures[0].periods).toBe(1);
    expect(slow.exposures[0].daysInArea).toBeGreaterThan(fast.exposures[0].daysInArea);
    expect(slow.exposures[0].periods).toBe(2);
    const change = compareWarRisk(fast, slow);
    expect(change.extraPeriods).toBe(1);
    expect(change.extraPremiumUsd).toBe(slow.totals.premiumUsd - fast.totals.premiumUsd);
    expect(change.lines[0]).toContain("1 → 2");
  });

  it("follows the ship: ahead, inside, passed", () => {
    const route = SUEZ_TO_COLOMBO;
    const start = assessWarRisk({ ...base, route, destPortStayHours: 0 });
    const e = start.exposures[0];
    expect(e.endsInside).toBe(false);
    expect(e.exitPosition.lat).toBeCloseTo(10.8, 0); // leaves at 10°48'N
    const inside = assessWarRisk({ ...base, route, sailedNm: (e.enterNm + e.exitNm) / 2, destPortStayHours: 0 });
    expect(inside.insideNow).toBe(true);
    expect(inside.currentAreaLabel).toBe(e.label);
    expect(inside.notifyBy).toBeNull();
    const passed = assessWarRisk({ ...base, route, sailedNm: e.exitNm + 100, destPortStayHours: 0 });
    expect(passed.exposures[0].status).toBe("PASSED");
    expect(passed.insideNow).toBe(false);
    expect(passed.kidnapAndRansomAdvised).toBe(false);
  });

  it("finds nothing on a European voyage", () => {
    const a = assessWarRisk({ ...base, route: [at(37.94, 23.63), at(36.0, -5.5), at(51.95, 4.1)] });
    expect(a.needsEndorsement).toBe(false);
    expect(a.exposures).toHaveLength(0);
    expect(a.crew).toHaveLength(0);
    expect(a.totals.totalUsd).toBe(0);
  });

  it("charges a call in a country listed as a whole, outside the defined waters", () => {
    // Piraeus → Haifa: Israel is listed by country.
    const a = assessWarRisk({ ...base, route: [at(37.94, 23.63), at(32.82, 34.99)], destCountry: "Israel" });
    expect(a.exposures).toHaveLength(1);
    expect(a.exposures[0].areaId).toBe("COUNTRY:israel");
    expect(a.exposures[0].rateBasis.assumption).toBe(true);
    expect(a.crew.map((c) => c.zoneId)).toEqual(["ISRAEL_LEBANON_ERZ"]);
    expect(a.crew[0].bonusDays).toBe(2); // ERZ Level 2: two days alongside
  });
});
