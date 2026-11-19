import type { ReactNode } from "react";
import type { CiiAssessment, Scenario, ScenarioId, ScenarioSet } from "@maritime/shared";
import { eur, money, utc } from "../lib/format.js";
import "./ScenarioComparison.css";

export function CiiBadge({ cii, showRatio = false }: { cii: CiiAssessment | null; showRatio?: boolean }) {
  if (!cii) return <span className="muted">—</span>;
  return (
    <span className="cii">
      <span className={`cii-badge cii-badge--${cii.rating.toLowerCase()}`} title={`Επιτευχθέν ${cii.attained.toFixed(2)} έναντι απαιτούμενου ${cii.required.toFixed(2)} gCO₂/dwt·nm`}>
        {cii.rating}
      </span>
      {showRatio && <span className="cii__ratio">{cii.ratio.toFixed(3)}</span>}
    </span>
  );
}

const JIT_LABEL: Record<string, string> = {
  NOT_APPLICABLE: "δ/υ",
  COVERED: "Καλύπτεται",
  NEEDS_INSTRUCTION: "Καλύπτεται, με εντολή",
  NOT_COVERED: "Δεν καλύπτεται",
  NO_CHARTER_PARTY: "Χωρίς ναυλοσύμφωνο",
};

interface Row {
  label: ReactNode;
  hint?: string;
  render: (s: Scenario) => ReactNode;
  /** Lower is better: highlight the best value in the row. */
  best?: (s: Scenario) => number;
}

interface Group {
  title: string;
  rows: Row[];
}

function groups(set: ScenarioSet): Group[] {
  const cur = set.scenarios.find((s) => s.contract.laytime)?.contract.laytime?.currency ?? "USD";
  const share = Math.round(set.etsCoveredShare * 100);
  return [
    {
      title: "Άφιξη",
      rows: [
        { label: "Ταχύτητα στο νερό", render: (s) => `${s.speedKn.toFixed(1)} kn` },
        { label: "Απόσταση", render: (s) => `${Math.round(s.distanceNm).toLocaleString("en-US")} nm` },
        {
          label: "ETA",
          render: (s) => (
            <>
              {utc(s.arrivalAt)}
              {s.lateHours > 0.5 && <span className="scenario-flag scenario-flag--bad"> {s.lateHours.toFixed(0)} h καθυστέρηση</span>}
            </>
          ),
        },
        { label: "Αναμονή στην άγκυρα", render: (s) => `${s.waitHours.toFixed(1)} h`, best: (s) => s.waitHours },
      ],
    },
    {
      title: "Καύσιμο & εκπομπές",
      rows: [
        { label: "Καύσιμο", render: (s) => `${s.fuelT.toFixed(1)} t`, best: (s) => s.fuelT },
        { label: "CO₂", render: (s) => `${s.co2T.toFixed(1)} t`, best: (s) => s.co2T },
      ],
    },
    {
      title: "Κόστος",
      rows: [
        { label: "Κόστος καυσίμου", hint: `€${set.prices.fuelPriceEurPerT}/t`, render: (s) => eur(s.fuelCostEur), best: (s) => s.fuelCostEur },
        {
          label: "EU ETS",
          hint: `${share}% του CO₂ × €${set.prices.euaPriceEurPerT}/t EUA`,
          render: (s) => eur(s.etsCostEur),
          best: (s) => s.etsCostEur,
        },
        { label: <strong>Σύνολο</strong>, render: (s) => <strong>{eur(s.totalCostEur)}</strong>, best: (s) => s.totalCostEur },
      ],
    },
    {
      title: "Ναυλοσύμφωνο",
      rows: [
        {
          label: "Laytime που χρησιμοποιείται",
          render: (s) => {
            const lt = s.contract.laytime;
            if (!lt) return <span className="muted">—</span>;
            return (
              <>
                {lt.usedHours.toFixed(0)} / {lt.allowedHours} h{" "}
                <span className={`scenario-flag ${lt.withinLaytime ? "scenario-flag--ok" : "scenario-flag--bad"}`}>
                  {lt.withinLaytime ? "εντός" : `+${lt.demurrageHours.toFixed(0)} h`}
                </span>
              </>
            );
          },
        },
        {
          label: "Demurrage",
          hint: cur,
          render: (s) => (s.contract.laytime ? money(s.contract.laytime.demurrageAmount, cur) : <span className="muted">—</span>),
          best: (s) => s.contract.laytime?.demurrageAmount ?? 0,
        },
        {
          label: "Ρήτρα JIT",
          render: (s) => (
            <span className={`scenario-flag scenario-flag--jit-${s.contract.jit.status.toLowerCase()}`} title={s.contract.jit.note}>
              {JIT_LABEL[s.contract.jit.status] ?? s.contract.jit.status}
            </span>
          ),
        },
      ],
    },
    {
      title: `CII ${set.year}`,
      rows: [
        { label: "Αυτό το σκέλος", hint: "μέθοδος CII μόνο για αυτό το σκέλος", render: (s) => <CiiBadge cii={s.cii.voyage} /> },
        {
          label: "Από αρχή έτους, μαζί με το σκέλος",
          hint: "επιτευχθέν / απαιτούμενο",
          render: (s) => <CiiBadge cii={s.cii.annual} showRatio />,
          best: (s) => s.cii.annual?.ratio ?? 0,
        },
      ],
    },
    {
      title: "Καιρός",
      rows: [
        {
          label: "Κατά μήκος της διαδρομής",
          render: (s) => (
            <span className="scenario-weather">
              {s.weather.description}
              {s.via && <span className="muted"> {s.via}</span>}
            </span>
          ),
        },
      ],
    },
  ];
}

interface Props {
  set: ScenarioSet;
  selected: ScenarioId | null;
  /** Null when decided: the table is read-only. */
  onSelect: ((id: ScenarioId) => void) | null;
}

/** Scenarios A/B/C side by side: ETA, fuel, CO₂, cost (fuel + EU ETS), demurrage, CII. */
export function ScenarioComparison({ set, selected, onSelect }: Props) {
  const source = set.scenarios[0]?.weather.source;
  return (
    <div className="scenarios">
      <div className="table-scroll" role="region" aria-label="Σύγκριση σεναρίων" tabIndex={0}>
        <table className="scenario-table">
          <thead>
            <tr>
              <th scope="col" className="scenario-table__corner">
                <span className="label">Σενάριο</span>
              </th>
              {set.scenarios.map((s) => (
                <th
                  key={s.id}
                  scope="col"
                  className={s.id === selected ? "scenario-col scenario-col--selected" : "scenario-col"}
                >
                  <label className="scenario-head">
                    {onSelect && s.id !== "A" ? (
                      <input
                        type="radio"
                        name={`scenario-${set.generatedAt}`}
                        checked={s.id === selected}
                        onChange={() => onSelect(s.id)}
                      />
                    ) : null}
                    <span className="scenario-head__id">{s.id}</span>
                    <span className="scenario-head__label">{s.label}</span>
                  </label>
                  {s.id === set.recommendedId && <span className="scenario-recommended">Προτείνεται</span>}
                </th>
              ))}
            </tr>
          </thead>
          {groups(set).map((g) => (
            <tbody key={g.title}>
              <tr className="scenario-group">
                <th scope="rowgroup" colSpan={set.scenarios.length + 1}>
                  {g.title}
                </th>
              </tr>
              {g.rows.map((row, i) => {
                const values = row.best ? set.scenarios.map(row.best) : [];
                const min = values.length ? Math.min(...values) : null;
                const unique = min != null && values.filter((v) => Math.abs(v - min) < 1e-6).length < values.length;
                return (
                  <tr key={i}>
                    <th scope="row">
                      {row.label}
                      {row.hint && <span className="scenario-hint">{row.hint}</span>}
                    </th>
                    {set.scenarios.map((s, j) => (
                      <td
                        key={s.id}
                        className={[
                          s.id === selected ? "scenario-col--selected" : "",
                          unique && Math.abs(values[j] - min!) < 1e-6 ? "scenario-cell--best" : "",
                        ].join(" ")}
                      >
                        {row.render(s)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="scenarios__foot">
        Καιρός: {source === "open-meteo" ? "θαλάσσια πρόγνωση Open-Meteo (κύμα, ρεύματα)" : "offline προσομοίωση (το Open-Meteo δεν απαντά)"} ·
        EU ETS {Math.round(set.etsCoveredShare * 100)}% ({set.etsVoyageScope === 1 ? "ταξίδι εντός ΕΕ" : set.etsVoyageScope === 0.5 ? "ταξίδι από/προς την ΕΕ" : "εκτός EU ETS"},{" "}
        ποσοστό {set.year}) · υπολογίστηκε {utc(set.generatedAt)}
      </p>
    </div>
  );
}
