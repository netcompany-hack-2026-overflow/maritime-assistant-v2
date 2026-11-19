/**
 * EU ETS for shipping (Directive 2003/87/EC as amended by (EU) 2023/959).
 *
 * - Phase-in of the surrender obligation by emissions year:
 *   2024: 40 %, 2025: 70 %, 2026 onwards: 100 %.
 * - Geographic scope: 100 % of emissions on voyages between two EU/EEA ports
 *   (and at berth in EU/EEA ports), 50 % on voyages that start or end
 *   outside the EU/EEA, 0 % between two non-EU ports.
 *
 * Pure functions, no I/O.
 */

/** EU member states plus the EEA states (Norway, Iceland, Liechtenstein). */
export const EU_EEA_COUNTRIES = new Set([
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark",
  "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland",
  "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands",
  "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
  "Norway", "Iceland", "Liechtenstein",
]);

export function isEuEea(country: string): boolean {
  return EU_EEA_COUNTRIES.has(country.trim());
}

/** Share of a year's emissions for which allowances must be surrendered. */
export function etsPhaseInForYear(year: number): number {
  if (year < 2024) return 0;
  if (year === 2024) return 0.4;
  if (year === 2025) return 0.7;
  return 1;
}

/** Share of a voyage's emissions that falls under the EU ETS. */
export function etsVoyageScope(originCountry: string, destCountry: string): number {
  const o = isEuEea(originCountry);
  const d = isEuEea(destCountry);
  if (o && d) return 1;
  if (o || d) return 0.5;
  return 0;
}

export interface EtsParams {
  euaPriceEurPerT: number;
  /** Emissions year; drives the phase-in percentage. */
  year: number;
  /** 1, 0.5 or 0 — see etsVoyageScope. */
  voyageScope: number;
}

/** Share of CO₂ that must be covered by allowances (phase-in × voyage scope). */
export function etsCoveredShare(p: Pick<EtsParams, "year" | "voyageScope">): number {
  return etsPhaseInForYear(p.year) * p.voyageScope;
}

/** € cost of the EU allowances needed for `co2T` tonnes of CO₂. */
export function etsCostEur(co2T: number, p: EtsParams): number {
  return co2T * etsCoveredShare(p) * p.euaPriceEurPerT;
}
