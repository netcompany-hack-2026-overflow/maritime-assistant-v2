import type { ReactNode } from "react";
import type { CiiAssessment, Scenario, ScenarioId, ScenarioSet } from "@maritime/shared";
import { eur, money, utc } from "../lib/format.js";
import "./ScenarioComparison.css";

export function CiiBadge({ cii, showRatio = false }: { cii: CiiAssessment | null; showRatio?: boolean }) {
  if (!cii) return <span className="muted">—</span>;
  return (
    <span className="cii">
      <span className={`cii-badge cii-badge--${cii.rating.toLowerCase()}`} title={`Attained ${cii.attained.toFixed(2)} vs required ${cii.required.toFixed(2)} gCO₂/dwt·nm`}>
        {cii.rating}
      </span>
      {showRatio && <span className="cii__ratio">{cii.ratio.toFixed(3)}</span>}
    </span>
  );
}

const JIT_LABEL: Record<string, string> = {
  NOT_APPLICABLE: "n/a",
  COVERED: "Covered",
  NEEDS_INSTRUCTION: "Covered, on instruction",
  NOT_COVERED: "Not covered",
  NO_CHARTER_PARTY: "No CP on file",
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
      title: "Arrival",
      rows: [
        { label: "Speed through water", render: (s) => `${s.speedKn.toFixed(1)} kn` },
        { label: "Distance", render: (s) => `${Math.round(s.distanceNm).toLocaleString("en-US")} nm` },
        {
          label: "ETA",
          render: (s) => (
            <>
              {utc(s.arrivalAt)}
              {s.lateHours > 0.5 && <span className="scenario-flag scenario-flag--bad"> {s.lateHours.toFixed(0)} h late</span>}
            </>
          ),
        },
        { label: "Wait at anchor", render: (s) => `${s.waitHours.toFixed(1)} h`, best: (s) => s.waitHours },
      ],
    },
    {
      title: "Fuel & emissions",
      rows: [
        { label: "Fuel", render: (s) => `${s.fuelT.toFixed(1)} t`, best: (s) => s.fuelT },
        { label: "CO₂", render: (s) => `${s.co2T.toFixed(1)} t`, best: (s) => s.co2T },
      ],
    },
    {
      title: "Cost",
      rows: [
        { label: "Fuel cost", hint: `€${set.prices.fuelPriceEurPerT}/t`, render: (s) => eur(s.fuelCostEur), best: (s) => s.fuelCostEur },
        {
          label: "EU ETS",
          hint: `${share}% of CO₂ × €${set.prices.euaPriceEurPerT}/t EUA`,
          render: (s) => eur(s.etsCostEur),
          best: (s) => s.etsCostEur,
        },
        { label: <strong>Total</strong>, render: (s) => <strong>{eur(s.totalCostEur)}</strong>, best: (s) => s.totalCostEur },
      ],
    },
    {
      title: "Charter party",
      rows: [
        {
          label: "Laytime used",
          render: (s) => {
            const lt = s.contract.laytime;
            if (!lt) return <span className="muted">—</span>;
            return (
              <>
                {lt.usedHours.toFixed(0)} / {lt.allowedHours} h{" "}
                <span className={`scenario-flag ${lt.withinLaytime ? "scenario-flag--ok" : "scenario-flag--bad"}`}>
                  {lt.withinLaytime ? "within" : `+${lt.demurrageHours.toFixed(0)} h`}
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
          label: "JIT clause",
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
        { label: "This leg", hint: "CII method on this leg only", render: (s) => <CiiBadge cii={s.cii.voyage} /> },
        {
          label: "Year to date incl. leg",
          hint: "attained / required",
          render: (s) => <CiiBadge cii={s.cii.annual} showRatio />,
          best: (s) => s.cii.annual?.ratio ?? 0,
        },
      ],
    },
    {
      title: "Weather",
      rows: [
        {
          label: "Along the route",
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
      <div className="table-scroll" role="region" aria-label="Scenario comparison" tabIndex={0}>
        <table className="scenario-table">
          <thead>
            <tr>
              <th scope="col" className="scenario-table__corner">
                <span className="label">Scenario</span>
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
                  {s.id === set.recommendedId && <span className="scenario-recommended">Recommended</span>}
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
        Weather: {source === "open-meteo" ? "Open-Meteo marine forecast (waves, ocean currents)" : "offline mock (Open-Meteo unavailable)"} ·
        EU ETS {Math.round(set.etsCoveredShare * 100)}% ({set.etsVoyageScope === 1 ? "intra-EU voyage" : set.etsVoyageScope === 0.5 ? "voyage to/from the EU" : "outside EU ETS scope"},{" "}
        {set.year} phase-in) · computed {utc(set.generatedAt)}
      </p>
    </div>
  );
}
