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
  supramax: { label: "Supramax φορτηγό χύδην, 58.000 dwt", type: "Bulk Carrier", dwt: 58_000, speed: 13.5, minSpeed: 9, fuel: 29, aux: 2.5 },
  panamax: { label: "Kamsarmax/Panamax φορτηγό χύδην, 82.000 dwt", type: "Bulk Carrier", dwt: 82_000, speed: 13.5, minSpeed: 9, fuel: 33, aux: 2.8 },
  mr: { label: "MR δεξαμενόπλοιο προϊόντων, 50.000 dwt", type: "Tanker", dwt: 50_000, speed: 13.5, minSpeed: 9, fuel: 28, aux: 4 },
  aframax: { label: "Aframax δεξαμενόπλοιο, 115.000 dwt", type: "Tanker", dwt: 115_000, speed: 13.5, minSpeed: 9, fuel: 44, aux: 5 },
} as const;
type ProfileKey = keyof typeof PROFILES;

const SOURCES = [
  {
    id: "ets",
    text: "Ευρωπαϊκή Επιτροπή — Reducing emissions from the shipping sector (σταδιακή ένταξη στο EU ETS 40% / 70% / 100%· 50% για ταξίδια εκτός ΕΕ)",
    url: "https://climate.ec.europa.eu/eu-action/transport/reducing-emissions-shipping-sector_en",
  },
  {
    id: "eua",
    text: "Reuters μέσω TradingView — δημοπρασία EUA στα €89,43/t στις 2 Νοε 2026· GMK Center — EUA ξανά πάνω από €90/t, 12–13 Νοε 2026",
    url: "https://www.tradingview.com/news/reuters.com,2026-11-02:newsml_APNB56IHF:0-european-union-auctions-2-792-mln-spot-carbon-permits-at-89-43-eur-t/",
  },
  {
    id: "cii",
    text: "DNV — IMO MEPC 83: συντελεστές μείωσης CII 13,625% (2027) ως 21,5% (2030) έναντι 2019",
    url: "https://www.dnv.com/news/imo-mepc-83-ghg-requirements-approved-taking-effect-from-2028/",
  },
  {
    id: "fuel",
    text: "Ship & Bunker — VLSFO Ρότερνταμ ≈ $734/t (17 Νοε 2026)",
    url: "https://shipandbunker.com/prices",
  },
  {
    id: "jit",
    text: "Μελέτη IMO / Low Carbon GIA — οι αφίξεις JIT μειώνουν καύσιμο και CO₂ έως 14% ανά ταξίδι· τα πλοία περνούν το 4,6% του χρόνου τους στην άγκυρα λόγω πρόωρης άφιξης (~15 μέρες τον χρόνο)",
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
      <p className="label">Επιχειρηματική αξία</p>
      <h2 className="value-title">
        Για ποιον είναι, τι εξοικονομεί, <em>γιατί τώρα.</em>
      </h2>

      <section className="value-section" aria-labelledby="who">
        <h3 id="who" className="value-h">
          <Building2 size={18} aria-hidden="true" /> Ο πελάτης
        </h3>
        <div className="value-cards">
          <div className="value-card">
            <p className="value-card__k">Αγοραστής</p>
            <p>
              Πλοιοκτήτριες-διαχειρίστριες εταιρείες με στόλους ξηρού φορτίου ή δεξαμενόπλοιων (10–60 πλοία) σε ναυλώσεις
              ταξιδιού, όπου οι καθυστερήσεις πρόσδεσης, το laytime και το demurrage κρίνουν το περιθώριο κάθε προσέγγισης.
              Οι Έλληνες πλοιοκτήτες, που ελέγχουν τον μεγαλύτερο στόλο παγκοσμίως σε deadweight, είναι η πρώτη αγορά.
            </p>
          </div>
          <div className="value-card">
            <p className="value-card__k">Καθημερινοί χρήστες</p>
            <p>
              <strong>Operations</strong> — παρακολούθηση ταξιδιών, ETA και συντονισμός πρόσδεσης με πράκτορες.{" "}
              <strong>Chartering</strong> — όροι ναυλοσυμφώνου, απαιτήσεις demurrage, ειδοποίηση ναυλωτών.{" "}
              <strong>Τεχνική / ESG</strong> — βαθμός CII και δικαιώματα EU ETS.
            </p>
          </div>
          <div className="value-card">
            <p className="value-card__k">Τι κάνει</p>
            <p>
              Μετατρέπει το «berth delayed 24 h» του πράκτορα σε κοστολογημένη απόφαση μέσα σε λεπτά: σενάρια A/B/C με
              καύσιμο, ETS, demurrage και CII, ελεγμένα με το ναυλοσύμφωνο, και έτοιμο το email προς τον ναυλωτή.
            </p>
          </div>
        </div>
      </section>

      <section className="value-section" aria-labelledby="saves">
        <h3 id="saves" className="value-h">
          <Anchor size={18} aria-hidden="true" /> Τι εξοικονομεί
        </h3>
        <p className="value-lede">
          Ίδιος υπολογισμός με τη σελίδα Ενέργειες (σενάριο B έναντι A, κυβικός νόμος καυσίμου, ήρεμη θάλασσα). Τιμές από τις
          Ρυθμίσεις: καύσιμο €{prices.fuel}/t, EUA €{prices.eua}/t, ETS {Math.round(etsPhaseInForYear(YEAR) * 100)}% για το {YEAR}. Αλλάξτε όποια παραδοχή θέλετε.
        </p>

        <div className="value-calc">
          <div className="value-inputs">
            <label className="value-field">
              <span>Προφίλ πλοίου</span>
              <select value={profileKey} onChange={(e) => setProfileKey(e.target.value as ProfileKey)}>
                {Object.entries(PROFILES).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="Πλοία στον στόλο" value={fleet} onChange={setFleet} min={1} max={500} />
            <NumberField label="Ειδοποιήσεις καθυστέρησης ανά πλοίο τον χρόνο" value={events} onChange={setEvents} min={0} max={60} />
            <NumberField label="Μέση καθυστέρηση πρόσδεσης" value={delayH} onChange={setDelayH} min={1} max={240} suffix="h" />
            <NumberField label="Απόσταση που απομένει όταν έρχεται η ειδοποίηση" value={distanceNm} onChange={setDistanceNm} min={100} max={8000} step={50} suffix="nm" />
            <NumberField label="Εμβέλεια EU ETS των δρομολογίων (μ.ό.)" value={euShare} onChange={setEuShare} min={0} max={100} step={5} suffix="%" />
            <NumberField label="Προσεγγίσεις όπου η αναμονή μετράει ως laytime" value={wibonShare} onChange={setWibonShare} min={0} max={100} step={5} suffix="%" />
            <NumberField label="Τιμή demurrage" value={demRate} onChange={setDemRate} min={0} max={100_000} step={500} suffix="USD/ημέρα" />
            <NumberField label="Μέρες στη θάλασσα τον χρόνο (για το CII)" value={seaDays} onChange={setSeaDays} min={100} max={350} step={5} suffix="μέρες" />
          </div>

          <div className="value-results">
            <p className="label">Ανά ειδοποίηση καθυστέρησης</p>
            <p className="value-results__event">
              {profile.speed} kn → {result.b.speedKn.toFixed(1)} kn · {result.perEvent.fuelT.toFixed(1)} t καύσιμο ·{" "}
              {eur(result.perEvent.fuelEur + result.perEvent.etsEur)}
            </p>

            <dl className="value-kpis">
              <div>
                <dt>Ανά πλοίο / έτος</dt>
                <dd>{eur(totalVessel)}</dd>
                <p>
                  καύσιμο {eur(v.fuelEur)} + EU ETS {eur(v.etsEur)}
                </p>
              </div>
              <div>
                <dt>Στόλος {fleet} πλοίων / έτος</dt>
                <dd>{eur(totalVessel * fleet)}</dd>
                <p>{Math.round(v.fuelT * fleet).toLocaleString("en-US")} t καύσιμο</p>
              </div>
              <div>
                <dt>CO₂ που αποφεύγεται / έτος</dt>
                <dd>{Math.round(v.co2T * fleet).toLocaleString("en-US")} t</dd>
                <p>≈ {result.ciiPct.toFixed(1)}% χαμηλότερο επιτευχθέν CII ανά πλοίο</p>
              </div>
              <div>
                <dt>Έκθεση σε demurrage που αποφεύγεται</dt>
                <dd>{money(v.demurrage * fleet, "USD")}</dd>
                <p>στόλος / έτος · {money(v.demurrage, "USD")} ανά πλοίο</p>
              </div>
            </dl>
            <p className="value-note">
              Το demurrage φαίνεται χωριστά: το πληρώνουν οι ναυλωτές στους πλοιοκτήτες, άρα είναι εξοικονόμηση για όποιον το
              επωμίζεται (operator που ναυλώνει πλοίο ή ναυλωτής με ρήτρα JIT), όχι επιπλέον όφελος και για τους δύο.
            </p>
          </div>
        </div>
      </section>

      <section className="value-section" aria-labelledby="now">
        <h3 id="now" className="value-h">
          <Clock size={18} aria-hidden="true" /> Γιατί τώρα
        </h3>
        <ol className="value-now">
          <li>
            <strong>Ο άνθρακας έχει πλέον πλήρη τιμή.</strong> Η ναυτιλία μπήκε στο EU ETS το 2024 με το 40% των εκπομπών,
            70% για το 2025 και 100% από το 2026, με τα EUA γύρω στα €90/t τον Νοέμβριο 2026. Κάθε τόνος καυσίμου σε σκέλος
            εντός ΕΕ κοστίζει πλέον περίπου {eur(prices.co2Factor * prices.eua)} σε δικαιώματα, πάνω από την τιμή του bunker. <sup>[1][2]</sup>
          </li>
          <li>
            <strong>Το CII σφίγγει συνεχώς.</strong> Η απαιτούμενη ένταση άνθρακα είναι 11% κάτω από το 2019 το 2026 και
            ανεβαίνει σε 13,625% το 2027 και 21,5% το 2030. Ένα D για τρία χρόνια ή ένα E σε ένα χρόνο επιβάλλει διορθωτικό
            σχέδιο, και οι ναυλωτές κοιτούν τον βαθμό. Οι ώρες στην άγκυρα προσθέτουν CO₂ χωρίς απόσταση, το χειρότερο για το CII. <sup>[3]</sup>
          </li>
          <li>
            <strong>Το καύσιμο είναι ακριβό.</strong> Το VLSFO στο Ρότερνταμ είναι γύρω στα $734/t (17 Νοε 2026), οπότε
            50–70 t που γλιτώνονται σε μία ειδοποίηση είναι πραγματικά χρήματα. <sup>[4]</sup>
          </li>
          <li>
            <strong>Η αγορά ζητά JIT.</strong> Η Global Industry Alliance του IMO βρήκε ότι τα πλοία περνούν το 4,6% του
            χρόνου τους στην άγκυρα επειδή φτάνουν νωρίς (περίπου 15 μέρες τον χρόνο), και ότι η άφιξη JIT μειώνει καύσιμο
            και CO₂ έως 14% ανά ταξίδι. Οι ρήτρες JIT υπάρχουν ήδη στα ναυλοσύμφωνα· αυτό που λείπει είναι το εργαλείο που
            τις εφαρμόζει σε κάθε ταξίδι. <sup>[5]</sup>
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
        <Ship size={14} aria-hidden="true" /> Εκτιμήσεις, όχι εγγυήσεις: τα προφίλ πλοίων είναι ενδεικτικά, εδώ ο καιρός
        θεωρείται ήρεμος (τα ζωντανά σενάρια χρησιμοποιούν την πρόγνωση) και η γραμμή demurrage υποθέτει laytime 72 h SHINC
        με 60 h φορτοεκφόρτωσης.
      </p>
    </div>
  );
}
