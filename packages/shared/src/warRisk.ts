import { greatCircleInterpolate, haversineNm, type LatLon } from "./geo.js";

/**
 * War-risk exposure of a voyage: which JWC Listed Areas the route crosses,
 * for how long, what the additional war premium comes to, and what the crew
 * is owed under the IBF/ITF risk-area list.
 *
 * How the insurance works (sources in README):
 * - Hull & machinery and P&I exclude war perils. The separate war-risks
 *   policy covers the ship worldwide EXCEPT the areas the Joint War Committee
 *   lists. Before entering one, the owner must notify the war underwriters and
 *   agree an additional premium (AP), a % of the hull value, usually for a
 *   7-day period. A longer stay needs further periods. Without notice there is
 *   no cover while inside the area.
 * - Piracy areas: kidnap & ransom (K&R) is a separate policy.
 * - Crew: in an IBF Warlike Operations Area the crew gets a bonus equal to the
 *   basic wage (minimum 5 days), double death/disability compensation and the
 *   right to refuse the passage. In a High Risk Area the bonus is for the
 *   actual days. In an Extended Risk Zone it is only paid on the day of an attack.
 *
 * Everything here is a pure function of the route and the numbers passed in.
 */

export const JWC_CIRCULAR = { ref: "JWLA-035", date: "2026-09-16" } as const;
export const IBF_LIST = {
  ref: "IBF/ITF list of designated risk areas",
  agreed: "2026-05-07",
  extendedTo: "2026-11-19",
} as const;

/** One additional premium buys cover for this many days in the area. */
export const WAR_COVER_PERIOD_DAYS = 7;
/** Time at the discharge port when the charter party gives none, hours (assumption). */
export const DEFAULT_PORT_OPS_HOURS = 48;
/** Crew size used for the IBF bonus (assumption). */
export const DEFAULT_CREW_COUNT = 20;
/** Average basic wage per crew member, USD/day (assumption). */
export const DEFAULT_CREW_WAGE_USD_PER_DAY = 45;
/** A port call in a listed country counts from this distance off the port, nm (12 nm territorial waters). */
export const COUNTRY_WATERS_NM = 12;
/** Distance between route samples when testing the areas, nm. */
const SAMPLE_STEP_NM = 5;

export type WarThreat = "WAR" | "PIRACY" | "TERRORISM";

export interface RateBasis {
  /** Additional premium, % of hull value per 7-day period. */
  pct: number;
  /** Reported market range, e.g. "3–10%". */
  range: string | null;
  source: string;
  /** True when no recent market figure was found and the rate is a placeholder. */
  assumption: boolean;
}

export interface RateZone {
  id: string;
  label: string;
  labelEn: string;
  /** null = the rest of the listed area. */
  polygon: LatLon[] | null;
  rate: RateBasis;
  threats: WarThreat[];
  /** Kidnap for ransom is a real risk here: a K&R policy is advised. */
  kidnapRisk: boolean;
}

export interface JwcArea {
  id: string;
  label: string;
  labelEn: string;
  /** Wording of the circular. */
  jwcName: string;
  polygon: LatLon[];
  zones: RateZone[];
  /** What the ship must do before and while inside (Greek). */
  reporting: string[];
}

export type CrewZoneCategory = "WOA" | "HRA" | "ERZ";

export interface CrewZone {
  id: string;
  label: string;
  category: CrewZoneCategory;
  polygon: LatLon[];
  /** ERZ Level 2 (Israeli/Lebanese ports): bonus for the days alongside. */
  portStayBonus?: boolean;
}

const poly = (points: Array<[number, number]>): LatLon[] => points.map(([lat, lon]) => ({ lat, lon }));

// ---------- JWC Listed Areas (JWLA-035, 16 September 2026) ----------
// Polygons follow the circular's defined boundaries at sea and run over land
// elsewhere (ships never sail there, so it doesn't matter where on land).

/** "Persian/Arabian Gulf, Gulf of Oman, Indian Ocean, Gulf of Aden and Southern Red Sea". */
const JWC_INDIAN_OCEAN = poly([
  [25.5, 32.0], // Red Sea, 25.5°N (west side, over Egypt)
  [25.5, 38.5], // 25.5°N (east side, over Saudi Arabia)
  [31.5, 46.0], // over Iraq, around the head of the Gulf
  [31.5, 50.0],
  [28.0, 56.5], // over Iran
  [26.4, 58.0],
  [26.0, 61.65],
  [25.32083, 65.0], // Pakistan coast at 25°19'15"N 65°E
  [10.8, 65.0], // high seas 10°48'N 65°E
  [10.8, 60.25], // 10°48'N 60°15'E
  [-6.75, 48.75], // 6°45'S 48°45'E
  [-1.6667, 41.5667], // Somalia border 1°40'S 41°34'E
  [9.0, 43.0], // over the Horn of Africa
  [14.0, 38.0],
]);

/** Southern Red Sea and Gulf of Aden, east to the IBF line (Yemen–Oman border, 13°25'N 53°E, Cape Guardafui). */
const RED_SEA_ADEN = poly([
  [25.5, 32.0],
  [25.5, 38.5],
  [17.5, 43.5],
  [16.65, 53.11], // Yemen–Oman border
  [13.4167, 53.0],
  [11.83, 51.28], // Gees Gwardafuy
  [9.0, 43.0],
  [14.0, 38.0],
]);

/** Persian Gulf, Strait of Hormuz and Gulf of Oman to the Ra's al Hadd line. */
const GULF_HORMUZ = poly([
  [31.5, 46.0],
  [31.5, 50.0],
  [28.0, 56.5],
  [26.4, 58.0],
  [26.0, 61.65],
  [25.175, 61.65], // Pakistan border
  [24.875, 61.65],
  [24.0, 60.97],
  [22.53, 59.8], // Ra's al Hadd
  [22.0, 58.5],
  [22.0, 55.0],
  [24.0, 47.0],
]);

/** Gulf of Guinea as defined in the circular: Togo coast, 0°40'S 3°E, Cape Lopez. */
const GULF_OF_GUINEA = poly([
  [6.1125, 1.2], // coast of Togo 6°06'45"N 1°12'E
  [-0.6667, 3.0], // 0°40'S 3°E
  [-0.6667, 8.7], // Cape Lopez 0°40'S 8°42'E
  [2.0, 12.0],
  [7.5, 10.0],
  [7.5, 1.2],
]);

/** Black Sea and Sea of Azov. The circular excludes Turkish, Bulgarian, Romanian and Georgian territorial waters; this polygon doesn't. */
const BLACK_SEA = poly([
  [41.3, 28.0],
  [42.5, 27.3],
  [44.2, 28.3],
  [45.5, 28.8],
  [47.0, 30.5],
  [47.5, 35.0],
  [47.6, 39.5],
  [45.5, 39.5],
  [43.5, 41.0],
  [41.5, 42.0],
  [40.8, 39.0],
  [41.0, 36.0],
  [41.6, 34.0],
  [41.0, 31.0],
  [41.05, 29.3],
]);

/** Cabo Delgado: territorial sea of Mozambique/Tanzania between Mnazi Bay and Baía do Lúrio. */
const CABO_DELGADO = poly([
  [-10.327, 40.315],
  [-10.172, 40.574],
  [-13.4995, 40.828],
  [-13.5, 40.527],
  [-13.5, 39.8],
  [-10.33, 39.8],
]);

const UKMTO = [
  "Εγγραφή στο UKMTO με αρχική αναφορά πριν την είσοδο στη Voluntary Reporting Area, ημερήσια αναφορά 08:00 UTC, τελική στην έξοδο.",
  "Μέτρα BMP Maritime Security και σχέδιο ασφάλειας του πλοίου για τη διέλευση.",
];

export const JWC_AREAS: JwcArea[] = [
  {
    id: "INDIAN_OCEAN",
    label: "Ερυθρά, Άντεν, Κόλπος, Ινδικός",
    labelEn: "Southern Red Sea, Gulf of Aden, Gulf of Oman, Persian Gulf and Indian Ocean",
    jwcName: "Persian/Arabian Gulf, Gulf of Oman, Indian Ocean, Gulf of Aden and Southern Red Sea",
    polygon: JWC_INDIAN_OCEAN,
    zones: [
      {
        id: "GULF_HORMUZ",
        label: "Περσικός Κόλπος, Ορμούζ, Κόλπος Ομάν",
        labelEn: "Persian Gulf, Strait of Hormuz and Gulf of Oman",
        polygon: GULF_HORMUZ,
        rate: {
          pct: 3,
          range: "3–10%",
          source: "Reuters / FT, Σεπ.–Οκτ. 2026: 3–10% της αξίας ανά διέλευση (δεξαμενόπλοια 6–10%)",
          assumption: false,
        },
        threats: ["WAR"],
        kidnapRisk: false,
      },
      {
        id: "RED_SEA_ADEN",
        label: "Νότια Ερυθρά, Μπαμπ ελ Μαντέμπ, Κόλπος Άντεν",
        labelEn: "Southern Red Sea, Bab el-Mandeb and Gulf of Aden",
        polygon: RED_SEA_ADEN,
        rate: {
          pct: 1,
          range: "1–2%",
          source: "Reuters, τέλη Ιουλ. 2026: 1–2% της αξίας (από 0,3%)",
          assumption: false,
        },
        threats: ["WAR", "PIRACY"],
        kidnapRisk: true,
      },
      {
        id: "INDIAN_OCEAN_W",
        label: "Αραβική Θάλασσα και Δυτικός Ινδικός",
        labelEn: "Arabian Sea and western Indian Ocean",
        polygon: null,
        rate: { pct: 0.05, range: null, source: "Χωρίς πρόσφατη τιμή αγοράς: ζητήστε προσφορά", assumption: true },
        threats: ["PIRACY"],
        kidnapRisk: true,
      },
    ],
    reporting: UKMTO,
  },
  {
    id: "GULF_OF_GUINEA",
    label: "Κόλπος Γουινέας",
    labelEn: "Gulf of Guinea",
    jwcName: "Gulf of Guinea, waters as defined",
    polygon: GULF_OF_GUINEA,
    zones: [
      {
        id: "GULF_OF_GUINEA",
        label: "Κόλπος Γουινέας",
        labelEn: "Gulf of Guinea",
        polygon: null,
        rate: { pct: 0.1, range: null, source: "Χωρίς πρόσφατη τιμή αγοράς: ζητήστε προσφορά", assumption: true },
        threats: ["PIRACY", "TERRORISM"],
        kidnapRisk: true,
      },
    ],
    reporting: [
      "Εγγραφή στο MDAT-GoG πριν την είσοδο και ημερήσιες αναφορές θέσης.",
      "Μέτρα BMP West Africa: citadel, επιτήρηση, αποφυγή αγκυροβολίας χωρίς φύλαξη.",
    ],
  },
  {
    id: "BLACK_SEA",
    label: "Μαύρη Θάλασσα και Αζοφική",
    labelEn: "Black Sea and Sea of Azov",
    jwcName: "Sea of Azov, Black Sea (excluding territorial waters of adjoining countries other than Russia and Ukraine) and inland waters",
    polygon: BLACK_SEA,
    zones: [
      {
        id: "BLACK_SEA",
        label: "Μαύρη Θάλασσα και Αζοφική",
        labelEn: "Black Sea and Sea of Azov",
        polygon: null,
        rate: {
          pct: 1,
          range: "0,6–1%+",
          source: "2026: λιμάνια Ουκρανίας πάνω από 1%, ρωσικά λιμάνια 0,6–0,8%",
          assumption: false,
        },
        threats: ["WAR"],
        kidnapRisk: false,
      },
    ],
    reporting: ["Οδηγίες της σημαίας και των ασφαλιστών για τη Μαύρη Θάλασσα (διάδρομοι, ναρκοθετημένες περιοχές)."],
  },
  {
    id: "CABO_DELGADO",
    label: "Κάμπο Ντελγκάντο (Μοζαμβίκη)",
    labelEn: "Cabo Delgado (Mozambique)",
    jwcName: "Cabo Delgado, waters as defined",
    polygon: CABO_DELGADO,
    zones: [
      {
        id: "CABO_DELGADO",
        label: "Κάμπο Ντελγκάντο",
        labelEn: "Cabo Delgado",
        polygon: null,
        rate: { pct: 0.05, range: null, source: "Χωρίς πρόσφατη τιμή αγοράς: ζητήστε προσφορά", assumption: true },
        threats: ["TERRORISM", "PIRACY"],
        kidnapRisk: true,
      },
    ],
    reporting: ["Αναφορές ασφάλειας κατά τις οδηγίες της σημαίας για τη διώρυγα της Μοζαμβίκης."],
  },
];

/** Countries listed as a whole: their ports and waters up to 12 nm. Checked by port of call. */
export const JWC_LISTED_COUNTRIES: Record<string, { label: string; rate: RateBasis }> = (() => {
  const placeholder: RateBasis = {
    pct: 0.5,
    range: null,
    source: "Χωρίς πρόσφατη τιμή αγοράς: ζητήστε προσφορά",
    assumption: true,
  };
  const names: Array<[string, string]> = [
    ["Benin", "Μπενίν"],
    ["Djibouti", "Τζιμπουτί"],
    ["Eritrea", "Ερυθραία"],
    ["Libya", "Λιβύη"],
    ["Nigeria", "Νιγηρία"],
    ["Somalia", "Σομαλία"],
    ["Sudan", "Σουδάν"],
    ["Togo", "Τόγκο"],
    ["Bahrain", "Μπαχρέιν"],
    ["Iran", "Ιράν"],
    ["Iraq", "Ιράκ"],
    ["Israel", "Ισραήλ"],
    ["Kuwait", "Κουβέιτ"],
    ["Lebanon", "Λίβανος"],
    ["Oman", "Ομάν"],
    ["Qatar", "Κατάρ"],
    ["Saudi Arabia", "Σαουδική Αραβία"],
    ["Syria", "Συρία"],
    ["United Arab Emirates", "Ηνωμένα Αραβικά Εμιράτα"],
    ["Yemen", "Υεμένη"],
    ["Venezuela", "Βενεζουέλα"],
  ];
  const out: Record<string, { label: string; rate: RateBasis }> = {};
  for (const [en, el] of names) out[en.toLowerCase()] = { label: el, rate: placeholder };
  out["russia"] = {
    label: "Ρωσία",
    rate: { pct: 0.7, range: "0,6–0,8%", source: "2026: ρωσικά λιμάνια 0,6–0,8%", assumption: false },
  };
  return out;
})();

const COUNTRY_ALIASES: Record<string, string> = {
  uae: "united arab emirates",
  "russian federation": "russia",
  "iran, islamic republic of": "iran",
  "syrian arab republic": "syria",
};

export function listedCountry(country: string | null | undefined): { key: string; label: string; rate: RateBasis } | null {
  if (!country) return null;
  const k = country.trim().toLowerCase();
  const key = COUNTRY_ALIASES[k] ?? k;
  const hit = JWC_LISTED_COUNTRIES[key];
  return hit ? { key, ...hit } : null;
}

// ---------- IBF/ITF crew risk areas (agreed 7 May 2026) ----------

export const CREW_ZONES: CrewZone[] = [
  {
    // Designations 1 and 2: Yemeni coast and Southern Red Sea / Gulf of Aden, south of 16°24.12'N.
    id: "RED_SEA_ADEN_WOA",
    label: "Νότια Ερυθρά και Κόλπος Άντεν",
    category: "WOA",
    polygon: poly([
      [16.402, 38.5],
      [16.402, 42.77],
      [17.3, 44.0],
      [16.65, 53.11],
      [13.4167, 53.0],
      [11.83, 51.28],
      [9.0, 43.0],
      [14.0, 38.0],
    ]),
  },
  {
    // Designation 7: all waters west of 24°N 57°06'E – 24°N 60°58'E – 24°52.5'N 61°39'E – Pakistan border.
    id: "GULF_HORMUZ_WOA",
    label: "Περσικός Κόλπος, Ορμούζ, Κόλπος Ομάν",
    category: "WOA",
    polygon: poly([
      [31.5, 46.0],
      [31.5, 50.0],
      [28.0, 56.5],
      [26.4, 58.0],
      [26.0, 61.65],
      [25.175, 61.65],
      [24.875, 61.65],
      [24.0, 60.97],
      [24.0, 57.1],
      [23.0, 56.5],
      [22.0, 55.0],
      [24.0, 47.0],
    ]),
  },
  {
    // Designation 8: south of 24°N to the Ra's al Hadd 035° line.
    id: "GULF_OMAN_ERZ",
    label: "Νότιος Κόλπος Ομάν",
    category: "ERZ",
    polygon: poly([
      [24.0, 57.1],
      [24.0, 60.97],
      [22.53, 59.8],
      [22.0, 58.5],
      [23.0, 56.5],
    ]),
  },
  {
    // Designations 3–5: Sea of Azov, Kerch Strait, northern Black Sea.
    id: "BLACK_SEA_NORTH_WOA",
    label: "Βόρεια Μαύρη Θάλασσα και Αζοφική",
    category: "WOA",
    polygon: poly([
      [45.2, 29.683],
      [45.167, 31.0],
      [45.35, 32.5],
      [45.05, 35.0],
      [45.05, 38.5],
      [47.6, 39.5],
      [47.5, 35.0],
      [47.0, 30.5],
      [45.5, 28.8],
    ]),
  },
  {
    // Designation 6: rest of the Black Sea north of 43°25'N 39°55'E – 44°04'N 31°24'E – 44°44'N 31°11'E – 45°12'N 29°41'E.
    id: "BLACK_SEA_HRA",
    label: "Μαύρη Θάλασσα",
    category: "HRA",
    polygon: poly([
      [45.2, 29.683],
      [44.733, 31.183],
      [44.067, 31.4],
      [43.417, 39.917],
      [44.6, 40.3],
      [45.05, 38.5],
      [45.05, 35.0],
      [45.35, 32.5],
      [45.167, 31.0],
    ]),
  },
  {
    // Designations 9–10: 12 nm off Israel and Lebanon; Level 2 for ships in their ports.
    id: "ISRAEL_LEBANON_ERZ",
    label: "Ακτές Ισραήλ και Λιβάνου",
    category: "ERZ",
    portStayBonus: true,
    polygon: poly([
      [31.697, 34.298],
      [32.5, 34.67],
      [33.0, 34.85],
      [33.5, 35.12],
      [34.0, 35.38],
      [34.636, 35.584],
      [34.636, 35.97],
      [33.0, 35.6],
      [31.595, 34.491],
    ]),
  },
];

// ---------- geometry ----------

/** Ray casting on lat/lon (none of the polygons crosses the antimeridian). */
export function pointInPolygon(p: LatLon, polygon: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.lat > p.lat !== b.lat > p.lat) {
      const lonAtLat = ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon;
      if (p.lon < lonAtLat) inside = !inside;
    }
  }
  return inside;
}

/** The listed area and rate zone at a position, or null outside the defined waters. */
export function jwcZoneAt(p: LatLon): { area: JwcArea; zone: RateZone } | null {
  for (const area of JWC_AREAS) {
    if (!pointInPolygon(p, area.polygon)) continue;
    const zone = area.zones.find((z) => z.polygon && pointInPolygon(p, z.polygon)) ?? area.zones.find((z) => !z.polygon) ?? area.zones[0];
    return { area, zone };
  }
  return null;
}

/** The IBF crew zone at a position, or null. */
export function crewZoneAt(p: LatLon): CrewZone | null {
  return CREW_ZONES.find((z) => pointInPolygon(p, z.polygon)) ?? null;
}

interface Sample {
  p: LatLon;
  nm: number;
}

/** Points every ~5 nm along the route, with the distance sailed to each. */
export function sampleRoute(route: LatLon[], stepNm = SAMPLE_STEP_NM): Sample[] {
  const out: Sample[] = [];
  let cum = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const d = haversineNm(a, b);
    const n = Math.max(1, Math.ceil(d / stepNm));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push({ p: k === 0 ? a : greatCircleInterpolate(a, b, f), nm: cum + f * d });
    }
    cum += d;
  }
  if (route.length > 0) out.push({ p: route[route.length - 1], nm: cum });
  return out;
}

export interface Span {
  fromNm: number;
  toNm: number;
}

/** Stretches of the route inside a polygon. Boundaries sit halfway between samples. */
export function spansInside(samples: Sample[], test: (p: LatLon) => boolean): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const inside = test(samples[i].p);
    if (inside && start === null) start = i === 0 ? 0 : (samples[i - 1].nm + samples[i].nm) / 2;
    if (!inside && start !== null) {
      spans.push({ fromNm: start, toNm: (samples[i - 1].nm + samples[i].nm) / 2 });
      start = null;
    }
  }
  if (start !== null && samples.length > 0) spans.push({ fromNm: start, toNm: samples[samples.length - 1].nm });
  return spans;
}

// ---------- assessment ----------

export type ExposureStatus = "AHEAD" | "INSIDE" | "PASSED";

export interface ZoneDays {
  zoneId: string;
  label: string;
  nm: number;
  days: number;
}

export interface WarRiskExposure {
  /** JWC area id, or "COUNTRY:<name>" for a port call in a listed country. */
  areaId: string;
  label: string;
  labelEn: string;
  jwcName: string;
  zones: ZoneDays[];
  /** The zone whose rate applies (the riskiest one crossed). */
  rateZoneId: string;
  rateZoneLabel: string;
  enterNm: number;
  exitNm: number;
  enterAt: string;
  exitAt: string;
  enterPosition: LatLon;
  exitPosition: LatLon;
  sailingDays: number;
  /** Waiting plus cargo operations at the destination, when the voyage ends inside. */
  portStayDays: number;
  endsInside: boolean;
  startsInside: boolean;
  daysInArea: number;
  periods: number;
  coveredDays: number;
  ratePct: number;
  rateBasis: RateBasis;
  /** True when the rate is the operator's own quote instead of the market figure. */
  quoted: boolean;
  premiumUsd: number;
  status: ExposureStatus;
  /** Hours until entry (AHEAD only). */
  hoursToEntry: number | null;
  threats: WarThreat[];
  kidnapRisk: boolean;
  reporting: string[];
}

export interface CrewExposure {
  zoneId: string;
  label: string;
  category: CrewZoneCategory;
  days: number;
  bonusDays: number;
  bonusUsd: number;
  enterAt: string;
  exitAt: string;
  status: ExposureStatus;
}

export interface WarRiskInput {
  route: LatLon[];
  speedKn: number;
  /** Distance already sailed; 0 at departure. */
  sailedNm: number;
  /** The moment `sailedNm` refers to. */
  now: Date;
  hullValueUsd: number;
  originCountry?: string | null;
  destCountry?: string | null;
  /** Waiting plus cargo operations at the destination, hours. */
  destPortStayHours: number;
  crewCount?: number;
  crewWageUsdPerDay?: number;
  /** Broker quotes, % per 7-day period, by rate-zone id (or "COUNTRY:<name>"). */
  quotedPct?: Record<string, number>;
}

export interface WarRiskAssessment {
  circular: typeof JWC_CIRCULAR;
  ibfList: typeof IBF_LIST;
  computedAt: string;
  routeNm: number;
  sailedNm: number;
  speedKn: number;
  hullValueUsd: number;
  crewCount: number;
  crewWageUsdPerDay: number;
  portStayHours: number;
  exposures: WarRiskExposure[];
  crew: CrewExposure[];
  /** Inside a listed area right now. */
  insideNow: boolean;
  currentAreaLabel: string | null;
  needsEndorsement: boolean;
  kidnapAndRansomAdvised: boolean;
  /** Notice to the war underwriters is due before this moment (first entry still ahead). */
  notifyBy: string | null;
  totals: {
    premiumUsd: number;
    crewBonusUsd: number;
    totalUsd: number;
    daysInListedAreas: number;
    periods: number;
  };
  assumptions: string[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function coverPeriods(days: number): number {
  return Math.max(1, Math.ceil(days / WAR_COVER_PERIOD_DAYS - 1e-9));
}

/** IBF bonus days: WOA at least 5, HRA the actual days, ERZ only on the day of an attack. */
export function crewBonusDays(category: CrewZoneCategory, days: number, portStayDays = 0): number {
  if (category === "WOA") return Math.max(5, Math.ceil(days - 1e-9));
  if (category === "HRA") return Math.max(0, Math.ceil(days - 1e-9));
  return Math.max(0, Math.ceil(portStayDays - 1e-9));
}

function positionAt(samples: Sample[], nm: number): LatLon {
  let best = samples[0];
  for (const s of samples) {
    if (Math.abs(s.nm - nm) < Math.abs(best.nm - nm)) best = s;
    if (s.nm > nm) break;
  }
  return { lat: round(best.p.lat, 2), lon: round(best.p.lon, 2) };
}

export function assessWarRisk(input: WarRiskInput): WarRiskAssessment {
  const speed = Math.max(0.1, input.speedKn);
  const crewCount = input.crewCount ?? DEFAULT_CREW_COUNT;
  const wage = input.crewWageUsdPerDay ?? DEFAULT_CREW_WAGE_USD_PER_DAY;
  const quoted = input.quotedPct ?? {};
  const samples = sampleRoute(input.route);
  const routeNm = samples.length > 0 ? samples[samples.length - 1].nm : 0;
  const sailed = Math.min(Math.max(0, input.sailedNm), routeNm);
  const at = (nm: number) => new Date(input.now.getTime() + ((nm - sailed) / speed) * 3_600_000).toISOString();
  const endsAtDest = (span: Span) => span.toNm >= routeNm - 0.5;
  const portStayHours = Math.max(0, input.destPortStayHours);

  const status = (span: Span, endsInside: boolean): ExposureStatus => {
    if (sailed < span.fromNm) return "AHEAD";
    if (sailed < span.toNm || (endsInside && sailed >= routeNm - 0.5)) return "INSIDE";
    return "PASSED";
  };

  const exposures: WarRiskExposure[] = [];

  const pushExposure = (
    base: { areaId: string; label: string; labelEn: string; jwcName: string; reporting: string[] },
    span: Span,
    zones: Array<{ zone: Pick<RateZone, "id" | "label" | "rate" | "threats" | "kidnapRisk">; nm: number; firstNm?: number }>
  ) => {
    const endsInside = endsAtDest(span);
    const sailingDays = (span.toNm - span.fromNm) / speed / 24;
    const portStayDays = endsInside ? portStayHours / 24 : 0;
    const daysInArea = sailingDays + portStayDays;
    const periods = coverPeriods(daysInArea);
    const effective = (z: (typeof zones)[number]["zone"]) => quoted[z.id] ?? z.rate.pct;
    const crossed = zones.filter((z) => z.nm > 0).sort((a, b) => (a.firstNm ?? 0) - (b.firstNm ?? 0));
    const pool = crossed.length > 0 ? crossed : zones;
    const rateZone = pool.reduce((a, b) => (effective(b.zone) > effective(a.zone) ? b : a)).zone;
    const ratePct = effective(rateZone);
    const st = status(span, endsInside);
    exposures.push({
      ...base,
      zones: crossed.map((z) => ({ zoneId: z.zone.id, label: z.zone.label, nm: round(z.nm, 0), days: round(z.nm / speed / 24, 1) })),
      rateZoneId: rateZone.id,
      rateZoneLabel: rateZone.label,
      enterNm: round(span.fromNm, 0),
      exitNm: round(span.toNm, 0),
      enterAt: at(span.fromNm),
      exitAt: new Date(new Date(at(span.toNm)).getTime() + portStayDays * 86_400_000).toISOString(),
      enterPosition: positionAt(samples, span.fromNm),
      exitPosition: positionAt(samples, span.toNm),
      sailingDays: round(sailingDays, 1),
      portStayDays: round(portStayDays, 1),
      endsInside,
      startsInside: span.fromNm <= 0.5,
      daysInArea: round(daysInArea, 1),
      periods,
      coveredDays: periods * WAR_COVER_PERIOD_DAYS,
      ratePct,
      rateBasis: rateZone.rate,
      quoted: quoted[rateZone.id] !== undefined,
      premiumUsd: Math.round((input.hullValueUsd * ratePct * periods) / 100),
      status: st,
      hoursToEntry: st === "AHEAD" ? round((span.fromNm - sailed) / speed, 1) : null,
      threats: [...new Set(pool.flatMap((z) => z.zone.threats))],
      kidnapRisk: pool.some((z) => z.zone.kidnapRisk),
    });
  };

  // Defined waters.
  const inAnyArea = (p: LatLon) => JWC_AREAS.some((a) => pointInPolygon(p, a.polygon));
  for (const area of JWC_AREAS) {
    for (const span of spansInside(samples, (p) => pointInPolygon(p, area.polygon))) {
      const nmByZone = new Map<string, number>(area.zones.map((z) => [z.id, 0]));
      const firstNm = new Map<string, number>();
      for (let i = 1; i < samples.length; i++) {
        const mid = (samples[i - 1].nm + samples[i].nm) / 2;
        if (mid < span.fromNm || mid > span.toNm) continue;
        const p = greatCircleInterpolate(samples[i - 1].p, samples[i].p, 0.5);
        const zone = area.zones.find((z) => z.polygon && pointInPolygon(p, z.polygon)) ?? area.zones.find((z) => !z.polygon) ?? area.zones[0];
        nmByZone.set(zone.id, (nmByZone.get(zone.id) ?? 0) + (samples[i].nm - samples[i - 1].nm));
        if (!firstNm.has(zone.id)) firstNm.set(zone.id, mid);
      }
      pushExposure(
        { areaId: area.id, label: area.label, labelEn: area.labelEn, jwcName: area.jwcName, reporting: area.reporting },
        span,
        area.zones.map((zone) => ({ zone, nm: nmByZone.get(zone.id) ?? 0, firstNm: firstNm.get(zone.id) }))
      );
    }
  }

  // Port calls in countries listed as a whole, outside the defined waters.
  const countryCall = (country: string | null | undefined, span: Span, point: LatLon | undefined) => {
    const hit = listedCountry(country);
    if (!hit || !point || inAnyArea(point)) return;
    const id = `COUNTRY:${hit.key}`;
    pushExposure(
      {
        areaId: id,
        label: hit.label,
        labelEn: country ?? hit.key,
        jwcName: `${country ?? hit.key} (ports and waters within 12 nm)`,
        reporting: ["Οδηγίες της σημαίας και του πράκτορα για την ασφάλεια στο λιμάνι."],
      },
      span,
      [{ zone: { id, label: hit.label, rate: hit.rate, threats: ["WAR"], kidnapRisk: false }, nm: span.toNm - span.fromNm }]
    );
  };
  if (routeNm > 0) {
    countryCall(input.originCountry, { fromNm: 0, toNm: Math.min(COUNTRY_WATERS_NM, routeNm) }, input.route[0]);
    countryCall(input.destCountry, { fromNm: Math.max(0, routeNm - COUNTRY_WATERS_NM), toNm: routeNm }, input.route[input.route.length - 1]);
  }
  exposures.sort((a, b) => a.enterNm - b.enterNm);

  // Crew (IBF).
  const crew: CrewExposure[] = [];
  for (const zone of CREW_ZONES) {
    for (const span of spansInside(samples, (p) => pointInPolygon(p, zone.polygon))) {
      const endsInside = endsAtDest(span);
      const days = (span.toNm - span.fromNm) / speed / 24 + (endsInside ? portStayHours / 24 : 0);
      const portStayDays = zone.portStayBonus && endsInside ? portStayHours / 24 : 0;
      const bonusDays = crewBonusDays(zone.category, days, portStayDays);
      crew.push({
        zoneId: zone.id,
        label: zone.label,
        category: zone.category,
        days: round(days, 1),
        bonusDays,
        bonusUsd: Math.round(bonusDays * crewCount * wage),
        enterAt: at(span.fromNm),
        exitAt: at(span.toNm),
        status: status(span, endsInside),
      });
    }
  }
  crew.sort((a, b) => a.enterAt.localeCompare(b.enterAt));

  const inside = exposures.find((e) => e.status === "INSIDE");
  const ahead = exposures.filter((e) => e.status === "AHEAD");
  const premiumUsd = exposures.reduce((s, e) => s + e.premiumUsd, 0);
  const crewBonusUsd = crew.reduce((s, c) => s + c.bonusUsd, 0);

  const assumptions = [
    `Περιοχές: JWC ${JWC_CIRCULAR.ref} (${JWC_CIRCULAR.date}). Πλήρωμα: λίστα IBF/ITF της ${IBF_LIST.agreed}, σε ισχύ ως ${IBF_LIST.extendedTo}.`,
    `Επασφάλιστρο = αξία σκάφους × ποσοστό × περίοδοι ${WAR_COVER_PERIOD_DAYS} ημερών. Τα ποσοστά είναι ενδεικτικά της αγοράς· το δεσμευτικό είναι η προσφορά του broker.`,
    "Μία χρέωση ανά διέλευση περιοχής, με το ποσοστό του πιο επικίνδυνου τμήματος που περνά το πλοίο.",
    `Χρόνος στο λιμάνι προορισμού όταν είναι μέσα σε περιοχή: ${round(portStayHours, 0)} ώρες (αναμονή για θέση και εργασίες φορτίου).`,
    `Μπόνους IBF: ${crewCount} άτομα πλήρωμα × ${wage} $/ημέρα μέσος βασικός μισθός (υπόθεση).`,
    "Οι χώρες που είναι στη λίστα ολόκληρες ελέγχονται από το λιμάνι αναχώρησης/προορισμού (12 nm). Δεν εξαιρούνται τα χωρικά ύδατα Αιγύπτου (Ερυθρά) και Τουρκίας, Βουλγαρίας, Ρουμανίας, Γεωργίας (Μαύρη Θάλασσα).",
  ];

  return {
    circular: JWC_CIRCULAR,
    ibfList: IBF_LIST,
    computedAt: input.now.toISOString(),
    routeNm: round(routeNm, 0),
    sailedNm: round(sailed, 0),
    speedKn: speed,
    hullValueUsd: input.hullValueUsd,
    crewCount,
    crewWageUsdPerDay: wage,
    portStayHours: round(portStayHours, 0),
    exposures,
    crew,
    insideNow: Boolean(inside),
    currentAreaLabel: inside ? inside.label : null,
    needsEndorsement: exposures.length > 0,
    kidnapAndRansomAdvised: exposures.some((e) => e.kidnapRisk && e.status !== "PASSED"),
    notifyBy: ahead.length > 0 ? ahead[0].enterAt : null,
    totals: {
      premiumUsd,
      crewBonusUsd,
      totalUsd: premiumUsd + crewBonusUsd,
      daysInListedAreas: round(exposures.reduce((s, e) => s + e.daysInArea, 0), 1),
      periods: exposures.reduce((s, e) => s + e.periods, 0),
    },
    assumptions,
  };
}

export interface WarRiskChange {
  /** Extra 7-day periods compared with the policy issued at departure. */
  extraPeriods: number;
  extraPremiumUsd: number;
  /** Areas the route now crosses that it didn't at departure. */
  newAreas: string[];
  lines: string[];
}

/** What changed since the policy was issued at departure (speed change, berth delay, new quote). */
export function compareWarRisk(atDeparture: WarRiskAssessment, current: WarRiskAssessment): WarRiskChange {
  const lines: string[] = [];
  let extraPeriods = 0;
  let extraPremiumUsd = 0;
  const newAreas: string[] = [];
  for (const now of current.exposures) {
    const before = atDeparture.exposures.find((e) => e.areaId === now.areaId && Math.abs(e.enterNm - now.enterNm) < 50);
    if (!before) {
      newAreas.push(now.label);
      extraPeriods += now.periods;
      extraPremiumUsd += now.premiumUsd;
      lines.push(`Νέα περιοχή στη διαδρομή: ${now.label} (${now.periods} περίοδος/οι).`);
      continue;
    }
    if (now.periods !== before.periods) {
      extraPeriods += now.periods - before.periods;
      lines.push(
        `${now.label}: ${before.daysInArea} → ${now.daysInArea} ημέρες στην περιοχή, ${before.periods} → ${now.periods} περίοδοι ${WAR_COVER_PERIOD_DAYS} ημερών.`
      );
    }
    if (now.premiumUsd !== before.premiumUsd) extraPremiumUsd += now.premiumUsd - before.premiumUsd;
  }
  return { extraPeriods, extraPremiumUsd, newAreas, lines };
}

// ---------- DTOs shared by the API and the web app ----------

export interface InsuranceNoticeDTO {
  to: string;
  subject: string;
  body: string;
  status: "DRAFT" | "SENT";
  /** Set once a person changes the text; edited drafts are never rewritten. */
  edited: boolean;
  sentAt: string | null;
  deliveredTo: string | null;
  lastError: string | null;
}

export interface VoyageInsuranceDTO {
  voyageId: string;
  vesselName: string;
  imo: string;
  vesselType: string;
  originPortName: string;
  destPortName: string;
  status: string;
  departedAt: string;
  hullValueUsd: number;
  /** As the voyage stands now (speed, berth time, position, quotes). */
  current: WarRiskAssessment;
  /** As issued when the voyage started. */
  atDeparture: WarRiskAssessment;
  change: WarRiskChange;
  charterParty: null | {
    reference: string | null;
    chartererName: string | null;
    warRisksClause: {
      present: boolean;
      name: string | null;
      text: string | null;
      additionalPremiumForCharterers: boolean | null;
      crewBonusForCharterers: boolean | null;
    };
  };
  analysis: { summary: string; source: "llm" | "template"; provider: string; generatedAt: string };
  notice: InsuranceNoticeDTO | null;
  /** Notices already sent for this voyage, newest first. */
  sentNotices: Array<{ subject: string; sentAt: string; deliveredTo: string | null }>;
  /** Broker quotes, % per 7-day period, by rate-zone id. */
  quotes: Record<string, number>;
  canSend: boolean;
  cannotSendReason: string | null;
}

/** One line of the voyages table. */
export interface VoyageInsuranceSummary {
  listed: boolean;
  areas: string[];
  insideNow: boolean;
  premiumUsd: number;
  periods: number;
  extraPeriods: number;
  noticeStatus: "DRAFT" | "SENT" | null;
}
