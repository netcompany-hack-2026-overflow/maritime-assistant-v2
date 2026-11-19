import { z } from "zod";
import type { WarRiskAnalysis, WarRiskFacts } from "./types.js";

/**
 * The war-risk analysis: the route check and every number are computed in
 * @maritime/shared (assessWarRisk). The model reads them, plus the charter
 * party's war risks clause, and writes (1) the operator's summary in Greek and
 * (2) the notice to the war underwriters in English. The template below writes
 * the same two texts offline and is the fallback when the model fails.
 */
export const WAR_RISK_SYSTEM_PROMPT =
  "You are the marine insurance assistant of a ship operator. The JSON describes one voyage and its exposure " +
  "to war-risk areas, all computed already: the Joint War Committee (JWC) Listed Areas the route crosses, " +
  "entry/exit times, days inside, 7-day cover periods, the additional war risks premium (AP), the IBF crew " +
  "risk zones with the crew bonus, and the charter party's war risks clause. Write two texts.\n" +
  "1) summary: plain Greek for the operator, at most 6 short sentences. Keep vessel and port names and the terms " +
  "JWC, IBF, AP, K&R, UKMTO, MDAT-GoG in Latin script. Say whether the ship is in, or will enter, a listed area " +
  "and when; what extra insurance is needed (AP: periods × rate × insured value = amount; K&R where kidnapRisk " +
  "is true; the crew bonus); what must be done before entry and by when (notifyByUtc; if the ship is already " +
  "inside, notify at once); and who pays under the charter party. Mention changeSinceDeparture if not empty.\n" +
  "2) notice: the email to the war risks underwriters (via the broker) in plain professional shipping English, " +
  "under 220 words, signed 'Operations': declare the voyage into the listed areas with entry/exit times (UTC), " +
  "entry position, days inside and periods, give the insured value and the working AP rate, ask them to confirm " +
  "cover and quote the AP (and K&R cover where kidnapRisk is true), and ask for any conditions of cover.\n" +
  "Restate only the facts and numbers given, rounded as given; never invent areas, rates, dates or contract " +
  'terms. Reply with ONLY a JSON object: {"summary":string,"notice":{"subject":string,"body":string}}.';

export const warRiskAnalysisSchema = z.object({
  summary: z.string().min(1),
  notice: z.object({ subject: z.string().min(1), body: z.string().min(1) }),
});

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtUtc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function whoPays(f: WarRiskFacts): string {
  const cp = f.charterParty;
  if (!cp) return "Δεν υπάρχει ναυλοσύμφωνο στο ταξίδι, οπότε δεν φαίνεται αν οι ναυλωτές επιστρέφουν το AP.";
  if (!cp.warClause) return "Το ναυλοσύμφωνο δεν έχει ρήτρα πολέμου: αν δεν συμφωνηθεί κάτι άλλο, το AP μένει στον πλοιοκτήτη.";
  if (cp.additionalPremiumForCharterers) {
    return (
      `Κατά το ναυλοσύμφωνο (${cp.warClause}) το AP το επιστρέφουν οι ναυλωτές` +
      `${cp.crewBonusForCharterers ? ", όπως και το μπόνους του πληρώματος" : ""}: χρεώστε το μαζί με τον ναύλο.`
    );
  }
  return `Το ναυλοσύμφωνο έχει ρήτρα πολέμου (${cp.warClause}) αλλά δεν λέει ποιος πληρώνει το AP: ελέγξτε τη διατύπωση.`;
}

/** Deterministic analysis; also the fallback when a real LLM fails. */
export async function mockAnalyseWarRisk(f: WarRiskFacts): Promise<WarRiskAnalysis> {
  if (f.exposures.length === 0) {
    return {
      source: "template",
      summary:
        `Η διαδρομή ${f.originPortName} → ${f.destPortName} δεν περνά από περιοχή της λίστας JWC (${f.circular}). ` +
        "Ισχύει η κανονική ασφάλιση πολέμου του πλοίου, χωρίς επασφάλιστρο και χωρίς δήλωση.",
      notice: { subject: "", body: "" },
    };
  }

  const open = f.exposures.filter((e) => e.status !== "PASSED");
  const areas = f.exposures.map((e) => e.area).join(", ");
  const parts: string[] = [];

  const ahead = f.exposures.find((e) => e.status === "AHEAD");
  if (f.insideNow) parts.push(`Το ${f.vesselName} είναι τώρα μέσα σε περιοχή της λίστας JWC (${f.currentArea}).`);
  else if (ahead) parts.push(`Η διαδρομή ${f.originPortName} → ${f.destPortName} μπαίνει σε περιοχή της λίστας JWC (${ahead.area}) στις ${fmtUtc(ahead.enterUtc)}.`);
  else parts.push(`Το ${f.vesselName} έχει ήδη βγει από την περιοχή της λίστας JWC (${areas}).`);

  for (const e of f.exposures) {
    parts.push(
      `${e.area}: ${e.daysInArea} ημέρες μέσα` +
        `${e.portStayDays > 0 ? ` (${e.sailingDays} πλεύση και ${e.portStayDays} στο λιμάνι)` : ""}, άρα ` +
        `${e.periods} ${plural(e.periods, "περίοδος", "περίοδοι")} των 7 ημερών × ${e.ratePct}% (${e.riskiestPart}) × ${usd(f.hullValueUsd)} = AP ${usd(e.premiumUsd)}.`
    );
  }

  if (f.notifyByUtc && !f.insideNow) {
    parts.push(
      `Το ταξίδι πρέπει να δηλωθεί στους ασφαλιστές πολέμου και να συμφωνηθεί το AP πριν τις ${fmtUtc(f.notifyByUtc)}· χωρίς δήλωση δεν υπάρχει κάλυψη μέσα στην περιοχή.`
    );
  } else if (f.insideNow) {
    parts.push("Αν δεν έχει δηλωθεί, δηλώστε το αμέσως: η κάλυψη διατηρείται (held covered) μόνο με άμεση ειδοποίηση και πληρωμή του AP.");
  }
  if (f.kidnapAndRansomAdvised) parts.push("Υπάρχει κίνδυνος πειρατείας με απαγωγές: προτείνεται ασφάλιση K&R για τη διέλευση.");

  const woa = f.crew.filter((c) => c.category === "WOA" && c.status !== "PASSED");
  if (woa.length > 0) {
    const days = woa.reduce((s, c) => s + c.bonusDays, 0);
    const bonus = woa.reduce((s, c) => s + c.bonusUsd, 0);
    parts.push(
      `Πλήρωμα (IBF, Warlike Operations Area): μπόνους ίσο με τον βασικό μισθό για ${days} ημέρες (≈ ${usd(bonus)}), διπλή αποζημίωση θανάτου/αναπηρίας και δικαίωμα άρνησης του ταξιδιού.`
    );
  }
  if (open.length > 0) parts.push(whoPays(f));
  if (f.changeSinceDeparture.length > 0) parts.push(`Αλλαγές από την αναχώρηση: ${f.changeSinceDeparture.join(" ")}`);

  return { source: "template", summary: parts.join(" "), notice: mockNotice(f) };
}

function mockNotice(f: WarRiskFacts): { subject: string; body: string } {
  const list = f.exposures.filter((e) => e.status !== "PASSED");
  const shown = list.length > 0 ? list : f.exposures;
  const inside = shown.some((e) => e.status === "INSIDE");
  const lines: string[] = [];
  lines.push("Dear Sirs,", "");
  lines.push(`Re: ${f.vesselName} (IMO ${f.imo}), ${f.vesselType}, insured value ${usd(f.hullValueUsd)} – war risks cover`, "");
  lines.push(
    `We hereby give notice under the vessel's war risks policy that on her voyage ${f.originPortName} – ${f.destPortName} ` +
      `the vessel ${inside ? "is now in" : "is due to enter"} the following area${shown.length > 1 ? "s" : ""} listed by the Joint War Committee (${f.circular}):`,
    ""
  );
  for (const e of shown) {
    lines.push(
      `- ${e.jwcName}: entry ${fmtUtc(e.enterUtc)} at ${e.enterPosition}, exit ${fmtUtc(e.exitUtc)}` +
        `${e.portStayDays > 0 ? ` (voyage ends at ${f.destPortName}, about ${Math.round(e.portStayDays * 24)} h in port)` : ""}. ` +
        `About ${e.daysInArea} days in the area: ${e.periods} period${e.periods > 1 ? "s" : ""} of 7 days.`
    );
  }
  lines.push("");
  const total = shown.reduce((s, e) => s + e.premiumUsd, 0);
  const rates = [...new Set(shown.map((e) => `${e.ratePct}%`))].join(" / ");
  lines.push(
    `${inside ? "Please hold the vessel covered and confirm" : "Please confirm"} cover for this voyage and quote the additional premium. ` +
      `Our working figure is ${rates} of the insured value per 7 days (${usd(total)} in total); please let us have your rate.`
  );
  if (shown.some((e) => e.kidnapRisk)) lines.push("Please also quote kidnap & ransom cover for the transit and, if available, war loss of hire.");
  lines.push("Please advise any conditions of cover (BMP Maritime Security, UKMTO / MDAT-GoG reporting, security personnel).", "");
  lines.push("We will advise you at once of any change of route or ETA.", "");
  lines.push("Best regards,", "Operations");
  return {
    subject: `${f.vesselName} (IMO ${f.imo}) – war risks notice: ${shown.map((e) => e.areaEn).join(" / ")}`,
    body: lines.join("\n"),
  };
}
