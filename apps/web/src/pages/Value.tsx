import { useEffect, useMemo, useState } from "react";
import { Anchor, Building2, Clock, Ship } from "lucide-react";
import { buildScenarios, etsPhaseInForYear, savingsVsBaseline, type CharterPartyTerms } from "@maritime/shared";
import { api } from "../lib/api.js";
import { eur, money } from "../lib/format.js";
import "./Value.css";

const YEAR = new Date().getUTCFullYear();
const H = 3_600_000;

/** Indicative vessel profiles (laden service speed and consumption). Editable below. */
const PROFILES = {
  supramax: { label: "Supramax bulk carrier, 58,000 dwt", type: "Bulk Carrier", dwt: 58_000, speed: 13.5, minSpeed: 9, fuel: 29, aux: 2.5 },
  panamax: { label: "Kamsarmax/Panamax bulk carrier, 82,000 dwt", type: "Bulk Carrier", dwt: 82_000, speed: 13.5, minSpeed: 9, fuel: 33, aux: 2.8 },
  mr: { label: "MR product tanker, 50,000 dwt", type: "Tanker", dwt: 50_000, speed: 13.5, minSpeed: 9, fuel: 28, aux: 4 },
  aframax: { label: "Aframax tanker, 115,000 dwt", type: "Tanker", dwt: 115_000, speed: 13.5, minSpeed: 9, fuel: 44, aux: 5 },
} as const;
type ProfileKey = keyof typeof PROFILES;

const SOURCES = [
  {
    id: "ets",
    text: "European Commission — Reducing emissions from the shipping sector (EU ETS phase-in 40% / 70% / 100%; 50% of extra-EU voyages)",
    url: "https://climate.ec.europa.eu/eu-action/transport/reducing-emissions-shipping-sector_en",
  },
  {
    id: "eua",
    text: "Reuters via TradingView — EU spot auction cleared at €89.43/t on 2 Nov 2026; GMK Center — EUA back above €90/t, 12–13 Nov 2026",
    url: "https://www.tradingview.com/news/reuters.com,2026-11-02:newsml_APNB56IHF:0-european-union-auctions-2-792-mln-spot-carbon-permits-at-89-43-eur-t/",
  },
  {
    id: "cii",
    text: "DNV — IMO MEPC 83: CII reduction factors 13.625% (2027) to 21.5% (2030) vs 2019",
    url: "https://www.dnv.com/news/imo-mepc-83-ghg-requirements-approved-taking-effect-from-2028/",
  },
  {
    id: "fuel",
    text: "Ship & Bunker — Rotterdam VLSFO ≈ $734/t (17 Nov 2026)",
    url: "https://shipandbunker.com/prices",
  },
  {
    id: "jit",
    text: "IMO / Low Carbon GIA study — JIT arrivals cut containership fuel and CO₂ by up to 14% per voyage; ships spend 4.6% of their time at anchor from early arrival (~15 days a year)",
    url: "https://www.imo.org/en/MediaCentre/Pages/WhatsNew-1326.aspx",
  },
];

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="value-field">
      <span>{label}</span>
      <span className="value-field__input">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, max != null ? Math.min(max, n) : n));
          }}
        />
        {suffix && <span>{suffix}</span>}
      </span>
    </label>
  );
}

export function Value() {
  const [prices, setPrices] = useState({ fuel: 600, eua: 90, co2Factor: 3.114 });
  const [profileKey, setProfileKey] = useState<ProfileKey>("supramax");
  const profile = PROFILES[profileKey];
  const [fleet, setFleet] = useState(20);
  const [events, setEvents] = useState(10);
  const [delayH, setDelayH] = useState(24);
  const [distanceNm, setDistanceNm] = useState(1200);
  const [euShare, setEuShare] = useState(60);
  const [wibonShare, setWibonShare] = useState(50);
  const [demRate, setDemRate] = useState(18_000);
  const [seaDays, setSeaDays] = useState(240);

  useEffect(() => {
    api
      .getMeta()
      .then((m) => setPrices({ fuel: m.fuelPriceEurPerT, eua: m.euaPriceEurPerT, co2Factor: m.co2Factor }))
      .catch(() => {});
  }, []);

  const result = useMemo(() => {
    const now = new Date(Date.UTC(YEAR, 5, 1));
    const eta = new Date(now.getTime() + (distanceNm / profile.speed) * H);
    const cp: CharterPartyTerms = {
      reference: null, chartererName: null, chartererEmail: null, agentEmail: null, vesselName: null,
      laytimeHours: 72, laytimeBasis: "SHINC", norNoticeHours: 6, waitingTimeCounts: true,
      demurrageRatePerDay: demRate, despatchRatePerDay: null, currency: "USD",
      jitClause: { present: true, name: null, text: null, speedReductionPermitted: true, requiresChartererInstruction: true },
      confidence: 1, sourceSpans: [],
    };
    const set = buildScenarios({
      now,
      berthTime: new Date(eta.getTime() + delayH * H),
      currentSpeedKn: profile.speed,
      vessel: {
        type: profile.type, dwt: profile.dwt, designSpeedKn: profile.speed, minSpeedKn: profile.minSpeed,
        fuelTPerDayAtDesign: profile.fuel, auxFuelTPerDay: profile.aux, ytdCo2T: null, ytdDistanceNm: null,
      },
      baseRoute: {
        distanceNm,
        weather: { headCurrentKn: 0, seaStateFuelFactor: 1, meanWaveM: null, maxWaveM: null, description: "calm", source: "mock" },
      },
      altRoute: null,
      co2Factor: prices.co2Factor,
      prices: { fuelPriceEurPerT: prices.fuel, euaPriceEurPerT: prices.eua },
      year: YEAR,
      // Fleet-average ETS scope: intra-EU legs at 100%, in/out of the EU at 50%.
      etsVoyageScope: euShare / 100,
      charterParty: cp,
      // Cargo operations take most of the laytime, so waiting tips the call into demurrage.
      opsHours: 60,
    });
    const d = savingsVsBaseline(set, "B");
    const b = set.scenarios[1];
    const perEvent = {
      fuelT: d.fuelT,
      co2T: d.co2T,
      fuelEur: d.fuelCostEur,
      etsEur: d.etsCostEur,
      demurrage: (d.demurrageAvoided ?? 0) * (wibonShare / 100),
    };
    const perVessel = {
      fuelT: perEvent.fuelT * events,
      co2T: perEvent.co2T * events,
      fuelEur: perEvent.fuelEur * events,
      etsEur: perEvent.etsEur * events,
      demurrage: perEvent.demurrage * events,
    };
    const annualCo2 = seaDays * profile.fuel * prices.co2Factor;
    return { set, b, perEvent, perVessel, ciiPct: (perVessel.co2T / annualCo2) * 100 };
  }, [profile, distanceNm, delayH, prices, euShare, wibonShare, demRate, events, seaDays]);

  const v = result.perVessel;
  const totalVessel = v.fuelEur + v.etsEur;

  return (
    <div className="page page--value">
      <p className="label">Business value</p>
      <h2 className="value-title">
        Who it is for, what it saves, <em>why now.</em>
      </h2>

      <section className="value-section" aria-labelledby="who">
        <h3 id="who" className="value-h">
          <Building2 size={18} aria-hidden="true" /> The customer
        </h3>
        <div className="value-cards">
          <div className="value-card">
            <p className="value-card__k">Buyer</p>
            <p>
              Ship owner-operators with dry bulk or tanker fleets (10–60 ships) trading on voyage charters, where berth
              delays, laytime and demurrage decide the margin of every call. Greek owners, who control the world’s largest
              fleet by deadweight, are the first market.
            </p>
          </div>
          <div className="value-card">
            <p className="value-card__k">Daily users</p>
            <p>
              <strong>Operations</strong> — voyage monitoring, ETA and berth coordination with agents.{" "}
              <strong>Chartering</strong> — charter-party terms, demurrage claims, the notice to charterers.{" "}
              <strong>Technical / ESG</strong> — CII rating and EU ETS allowances.
            </p>
          </div>
          <div className="value-card">
            <p className="value-card__k">The job it does</p>
            <p>
              Turns an agent’s “berth delayed 24 h” into a costed decision in minutes: A/B/C scenarios with fuel, ETS,
              demurrage and CII, checked against the charter party, and the email to the charterer drafted.
            </p>
          </div>
        </div>
      </section>

      <section className="value-section" aria-labelledby="saves">
        <h3 id="saves" className="value-h">
          <Anchor size={18} aria-hidden="true" /> What it saves
        </h3>
        <p className="value-lede">
          Same engine as the Actions page (scenario B vs A, cube-law fuel, calm water). Prices from Settings: fuel €{prices.fuel}/t,
          EUA €{prices.eua}/t, {Math.round(etsPhaseInForYear(YEAR) * 100)}% ETS phase-in in {YEAR}. Change any assumption.
        </p>

        <div className="value-calc">
          <div className="value-inputs">
            <label className="value-field">
              <span>Vessel profile</span>
              <select value={profileKey} onChange={(e) => setProfileKey(e.target.value as ProfileKey)}>
                {Object.entries(PROFILES).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="Ships in the fleet" value={fleet} onChange={setFleet} min={1} max={500} />
            <NumberField label="Late-berth notices per ship per year" value={events} onChange={setEvents} min={0} max={60} />
            <NumberField label="Average berth delay" value={delayH} onChange={setDelayH} min={1} max={240} suffix="h" />
            <NumberField label="Distance to go when the notice arrives" value={distanceNm} onChange={setDistanceNm} min={100} max={8000} step={50} suffix="nm" />
            <NumberField label="EU ETS scope of the trade (avg.)" value={euShare} onChange={setEuShare} min={0} max={100} step={5} suffix="%" />
            <NumberField label="Calls where waiting counts as laytime" value={wibonShare} onChange={setWibonShare} min={0} max={100} step={5} suffix="%" />
            <NumberField label="Demurrage rate" value={demRate} onChange={setDemRate} min={0} max={100_000} step={500} suffix="USD/day" />
            <NumberField label="Sea days per year (for CII share)" value={seaDays} onChange={setSeaDays} min={100} max={350} step={5} suffix="days" />
          </div>

          <div className="value-results">
            <p className="label">Per late-berth notice</p>
            <p className="value-results__event">
              {profile.speed} kn → {result.b.speedKn.toFixed(1)} kn · {result.perEvent.fuelT.toFixed(1)} t fuel ·{" "}
              {eur(result.perEvent.fuelEur + result.perEvent.etsEur)}
            </p>

            <dl className="value-kpis">
              <div>
                <dt>Per ship / year</dt>
                <dd>{eur(totalVessel)}</dd>
                <p>
                  fuel {eur(v.fuelEur)} + EU ETS {eur(v.etsEur)}
                </p>
              </div>
              <div>
                <dt>Fleet of {fleet} / year</dt>
                <dd>{eur(totalVessel * fleet)}</dd>
                <p>{Math.round(v.fuelT * fleet).toLocaleString("en-US")} t fuel</p>
              </div>
              <div>
                <dt>CO₂ avoided / year</dt>
                <dd>{Math.round(v.co2T * fleet).toLocaleString("en-US")} t</dd>
                <p>≈ {result.ciiPct.toFixed(1)}% lower attained CII per ship</p>
              </div>
              <div>
                <dt>Demurrage exposure avoided</dt>
                <dd>{money(v.demurrage * fleet, "USD")}</dd>
                <p>fleet / year · {money(v.demurrage, "USD")} per ship</p>
              </div>
            </dl>
            <p className="value-note">
              Demurrage is shown apart: it is paid by charterers to owners, so it is a saving for whoever carries it
              (an operator chartering in, or the charterer under a JIT clause), not an extra for both.
            </p>
          </div>
        </div>
      </section>

      <section className="value-section" aria-labelledby="now">
        <h3 id="now" className="value-h">
          <Clock size={18} aria-hidden="true" /> Why now
        </h3>
        <ol className="value-now">
          <li>
            <strong>Carbon now has a full price.</strong> Shipping entered the EU ETS in 2024 at 40% of emissions, 70% for
            2025 and 100% from 2026, with EUAs trading around €90/t in November 2026. Every tonne of fuel on an intra-EU
            leg now costs about {eur(prices.co2Factor * prices.eua)} in allowances on top of the bunker price. <sup>[1][2]</sup>
          </li>
          <li>
            <strong>CII keeps tightening.</strong> Required carbon intensity is 11% below 2019 in 2026 and steps to 13.625%
            in 2027 and 21.5% in 2030. A D for three years or an E in one year forces a corrective plan, and charterers
            screen on the rating. Hours at anchor add CO₂ with no distance, the worst thing for CII. <sup>[3]</sup>
          </li>
          <li>
            <strong>Fuel is expensive.</strong> Rotterdam VLSFO is around $734/t (17 Nov 2026), so 50–70 t saved on one
            notice is real money. <sup>[4]</sup>
          </li>
          <li>
            <strong>The industry is asking for JIT.</strong> IMO’s Global Industry Alliance found ships spend 4.6% of their
            time at anchor because they arrive early (about 15 days a year) and JIT arrival cuts fuel and CO₂ by up to 14%
            per voyage. JIT clauses now exist for charter parties; what is missing is the tool that applies them per
            voyage. <sup>[5]</sup>
          </li>
        </ol>
        <ol className="value-sources">
          {SOURCES.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.text}
              </a>
            </li>
          ))}
        </ol>
      </section>

      <p className="value-foot">
        <Ship size={14} aria-hidden="true" /> Estimates, not guarantees: vessel profiles are indicative, weather is calm
        water here (the live scenarios use the forecast) and the demurrage line assumes a 72 h SHINC laytime with 60 h of
        cargo operations.
      </p>
    </div>
  );
}
