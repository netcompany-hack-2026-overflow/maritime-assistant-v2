import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import {
  DEFAULT_TCO,
  TCO_LABELS,
  compareOffers,
  explainComparison,
  formatUtc,
  tcoOfferFromDTO,
  type BunkerOfferDTO,
  type BunkerOption,
  type BunkerWaypoint,
  type TcoAssumptions,
  type TcoBreakdown,
  type TcoOffer,
  type TcoRow,
  type Urgency,
} from "@maritime/shared";
import { api, type MetaResponse } from "../lib/api.js";
import { NOT_TAKEN_PREFIX } from "../lib/labels.js";
import { RouteSketch } from "../components/RouteSketch.js";
import { EmailDraftEditor } from "../components/EmailDraftEditor.js";
import "./Bunkering.css";

const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const perT = (v: number) => `$${v.toFixed(2)}`;
const eur = (v: number) => `${v < 0 ? "−" : ""}€${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

/** Re-render every second for the quote countdowns. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function countdown(until: string | null, now: number): { text: string; level: "ok" | "soon" | "lapsed" } | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return { text: "έληξε: ζητήστε νέα τιμή", level: "lapsed" };
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `απομένουν ${h} h ${String(m).padStart(2, "0")} min` : `απομένουν ${m}:${String(s).padStart(2, "0")}`;
  // Short-fuse quotes ("firm 10 mins") warn from the moment they arrive.
  return { text, level: ms < 15 * 60_000 ? "soon" : "ok" };
}

function bargingText(o: BunkerOfferDTO): string {
  const t = o.terms;
  if (t.bargingType === "LUMP_SUM") return `${usd(t.bargingUsd ?? 0)} εφάπαξ`;
  if (t.bargingType === "PER_MT") return `$${t.bargingUsd}/t`;
  if (t.bargingType === "INCLUDED") return "περιλαμβάνεται";
  return "δεν αναφέρεται";
}

const WAYPOINT_LABEL: Record<BunkerWaypoint["kind"], (port: string, dest: string) => string> = {
  SHIP: () => "Πλοίο τώρα",
  TURN_OFF: () => "Έξοδος από την προγραμματισμένη διαδρομή",
  BUNKER_ARRIVE: (port) => `Άφιξη ${port}`,
  BUNKER_DEPART: (port) => `Αναχώρηση ${port}`,
  REJOIN: () => "Επιστροφή στην προγραμματισμένη διαδρομή",
  DESTINATION: (_, dest) => `Άφιξη ${dest}`,
};

const URGENCY_LABEL: Record<Urgency, string> = { LOW: "Χαμηλό", NORMAL: "Κανονικό", HIGH: "Υψηλό" };

const OPTION_TITLE: Record<BunkerOption["key"], string> = {
  ECO: "Ανεφοδιασμός και μετά μείωση ταχύτητας για άφιξη ακριβώς στην ώρα",
  KEEP_SPEED: "Ανεφοδιασμός με την ίδια ταχύτητα (με περιθώριο χρόνου)",
};

function OptionCard({ option, offer, chosen }: { option: BunkerOption; offer: BunkerOfferDTO; chosen: boolean }) {
  const c = option.calc;
  const stop = c.portHours + (c.delayHours ?? 0);
  const speedText =
    c.speedAfterBunkerKn !== undefined && Math.abs(c.speedAfterBunkerKn - c.speedBunkerKn) >= 0.05
      ? `${c.speedBunkerKn.toFixed(1)} kn ως ${offer.port.name}, μετά ${c.speedAfterBunkerKn.toFixed(1)} kn`
      : `${c.speedBunkerKn.toFixed(1)} kn`;
  return (
    <div className={chosen ? "option-card option-card--chosen" : "option-card"}>
      <div className="option-card__head">
        <p className="option-card__title">{OPTION_TITLE[option.key]}</p>
        {chosen && <span className="chip chip--ok">επιλέχθηκε</span>}
        <span className={c.verdict === "WORTH_IT" ? "chip chip--ok" : "chip chip--no"}>
          {c.verdict === "WORTH_IT" ? "συμφέρει" : "δεν συμφέρει"}
        </span>
      </div>
      <dl className="option-card__facts">
        <div><dt>Προτεινόμενη ταχύτητα</dt><dd>{speedText} <span className="muted">(τώρα {c.v0.toFixed(1)} kn)</span></dd></div>
        <div><dt>Παράκαμψη</dt><dd>{c.detourNm.toFixed(0)} nm πήγαινε-έλα</dd></div>
        <div><dt>Χρόνος στο {offer.port.name}</dt><dd>{stop.toFixed(1)} h{c.delayHours ? ` (μαζί με ${c.delayHours.toFixed(1)} h αναμονή barge)` : ""}</dd></div>
        <div><dt>Ποσότητα</dt><dd>{c.qtyT.toLocaleString("en-US")} t στα ${c.priceUsdPerT}/t</dd></div>
        <div><dt>Επιπλέον καύσιμο σε σχέση με χωρίς ανεφοδιασμό</dt><dd>{c.extraFuelT.toFixed(1)} t ({c.extraCo2T.toFixed(1)} t CO₂)</dd></div>
        <div><dt>Περιθώριο στην πρόσδεση</dt><dd>{c.waitHoursBunker.toFixed(1)} h{c.lateHours > 0 ? `, ${Math.round(c.lateHours * 60)} min καθυστέρηση (εντός ανοχής)` : ""}</dd></div>
        <div className="option-card__net"><dt>Καθαρό έναντι της δικής μας τιμής €{c.refPriceEurPerT}/t</dt><dd>{eur(c.netEur)}</dd></div>
        {option.breakEvenUsdPerT !== null && (
          <div><dt>Νεκρό σημείο στα</dt><dd>${option.breakEvenUsdPerT.toFixed(2)}/t</dd></div>
        )}
      </dl>
      <table className="waypoints">
        <caption className="visually-hidden">Νέα διαδρομή</caption>
        <thead>
          <tr><th scope="col">Διαδρομή</th><th scope="col">Ώρα (UTC)</th><th scope="col">Ταχύτητα</th></tr>
        </thead>
        <tbody>
          {option.waypoints.map((w) => (
            <tr key={w.kind}>
              <td>{WAYPOINT_LABEL[w.kind](offer.port.name, offer.voyage.destPortName)}</td>
              <td>{formatUtc(w.at).replace(" UTC", "")}</td>
              <td>{w.speedKn === null ? "—" : `${w.speedKn.toFixed(1)} kn`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Bunkering() {
  const [params, setParams] = useSearchParams();
  const [offers, setOffers] = useState<BunkerOfferDTO[]>([]);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voyageId, setVoyageId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("offer"));
  // What-if inputs; null = the voyage's own default.
  const [charter, setCharter] = useState<number | null>(null);
  const [stemQty, setStemQty] = useState<number | null>(null);
  const [urgency, setUrgency] = useState<Urgency>(DEFAULT_TCO.urgency);
  const [etsEnabled, setEtsEnabled] = useState(DEFAULT_TCO.etsEnabled);
  // null = the EUA price from Settings (the one the speed scenarios use too).
  const [etsPriceOverride, setEtsPrice] = useState<number | null>(null);
  const [settingsEua, setSettingsEua] = useState<number | null>(null);
  const etsPrice = etsPriceOverride ?? settingsEua ?? DEFAULT_TCO.etsPriceEurPerT;
  const [ai, setAi] = useState<{ text: string; busy: boolean; error: string | null }>({ text: "", busy: false, error: null });
  const now = useNow();

  const refresh = () =>
    Promise.all([api.getBunkerOffers(), api.getMeta(), api.getSettings()])
      .then(([list, m, s]) => {
        setOffers(list);
        setMeta(m);
        setSettingsEua(s.euaPriceEurPerT);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // Ships with offers, the one with the newest offer first.
  const voyages = useMemo(() => {
    const seen = new Map<string, BunkerOfferDTO["voyage"]>();
    for (const o of offers) if (!seen.has(o.voyage.id)) seen.set(o.voyage.id, o.voyage);
    return [...seen.values()];
  }, [offers]);

  useEffect(() => {
    const fromLink = offers.find((o) => o.recommendationId === params.get("offer"));
    if (fromLink && voyageId === null) setVoyageId(fromLink.voyage.id);
    else if (voyageId === null && voyages[0]) setVoyageId(voyages[0].id);
  }, [offers, voyages, voyageId, params]);

  const voyage = voyages.find((v) => v.id === voyageId) ?? null;
  const voyageOffers = useMemo(() => offers.filter((o) => o.voyage.id === voyageId), [offers, voyageId]);
  // Every offer stays in the comparison, decided or not, so the choice can be explained.
  const open = voyageOffers;
  const accepted = voyageOffers.find((o) => o.status === "APPROVED") ?? null;
  const defaultStem = open.find((o) => o.plan)?.plan?.input.stemQtyT ?? 800;

  const assumptions: TcoAssumptions = {
    ...DEFAULT_TCO,
    stemQtyT: stemQty ?? defaultStem,
    charterUsdPerDay: charter ?? voyage?.charterRateUsdPerDay ?? 15_000,
    urgency,
    etsEnabled,
    etsPriceEurPerT: etsPrice,
  };

  const tcoOffers = useMemo(() => open.map(tcoOfferFromDTO).filter((o): o is TcoOffer => o !== null), [open]);
  const rows = useMemo(
    () => compareOffers(tcoOffers, assumptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tcoOffers, assumptions.stemQtyT, assumptions.charterUsdPerDay, urgency, etsEnabled, etsPrice]
  );
  const explanation = useMemo(() => explainComparison(rows), [rows]);
  const byId = new Map(voyageOffers.map((o) => [o.recommendationId, o]));
  const selected = byId.get(selectedId ?? "") ?? (rows[0] ? byId.get(rows[0].offer.id) : undefined) ?? voyageOffers[0] ?? null;
  const legacy = open.filter((o) => !o.plan);

  // The AI text describes the numbers it was given; drop it when they change.
  useEffect(() => setAi({ text: "", busy: false, error: null }), [voyageId, assumptions.stemQtyT, assumptions.charterUsdPerDay, urgency, etsEnabled, etsPrice]);

  const urgentQuotes = open
    .map((o) => ({ o, c: countdown(o.terms.quoteFirmUntil, now) }))
    .filter((x) => x.c && x.c.level !== "ok" && x.o.status === "PENDING");

  const handleSimulate = async () => {
    setSimulating(true);
    setNotice(null);
    try {
      const res = await api.simulateBunkerQuotes();
      await refresh();
      const matched = res.filter((r) => r.matchedVoyageId);
      setNotice(`Ήρθαν και αναλύθηκαν ${res.length} προσφορές προμηθευτών${matched.length < res.length ? ` (${res.length - matched.length} δεν αντιστοιχούν σε πλοίο εν πλω)` : ""}.`);
      if (matched[0]?.matchedVoyageId) setVoyageId(matched[0].matchedVoyageId);
      setSelectedId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  const handleAskAi = async () => {
    if (!voyageId) return;
    setAi({ text: "", busy: true, error: null });
    try {
      const res = await api.explainBunkerOffers(voyageId, assumptions);
      setAi({ text: res.text, busy: false, error: null });
    } catch (e) {
      setAi({ text: "", busy: false, error: (e as Error).message });
    }
  };

  const selectOffer = (id: string) => {
    setSelectedId(id);
    setParams((p) => {
      p.set("offer", id);
      return p;
    }, { replace: true });
  };

  if (loading) {
    return (
      <div className="page page--bunkering">
        <div className="loading-state" role="status">Φόρτωση προσφορών…</div>
      </div>
    );
  }

  const provider = meta?.emailProvider ?? null;
  const breakdownKeys = Object.keys(TCO_LABELS) as Array<keyof TcoBreakdown>;
  const cell = (r: TcoRow, k: keyof TcoBreakdown) => (r.breakdown ? usd(r.breakdown[k]) : "—");

  return (
    <div className="page page--bunkering">
      <div className="bunkering-head">
        <div>
          <p className="label">Ανεφοδιασμός</p>
          <h2 className="bunkering-head__title">Προσφορές προμηθευτών, σε σύγκριση συνολικού κόστους</h2>
        </div>
        <div className="bunkering-head__actions">
          {voyages.length > 1 && (
            <label className="bunkering-head__select">
              <span className="visually-hidden">Πλοίο</span>
              <select value={voyageId ?? ""} onChange={(e) => { setVoyageId(e.target.value); setSelectedId(null); setCharter(null); }}>
                {voyages.map((v) => (
                  <option key={v.id} value={v.id}>{v.vesselName} · {v.originPortName} → {v.destPortName}</option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary" onClick={handleSimulate} disabled={simulating}>
            {simulating ? "Ανάγνωση προσφορών…" : "Προσομοίωση προσφορών προμηθευτών"}
          </button>
        </div>
      </div>
      <p className={provider?.configured ? "provider provider--ok" : "provider"}>
        {provider?.configured
          ? `Οι απαντήσεις στέλνονται από ${provider.from}${provider.redirectTo ? `, με ανακατεύθυνση στο ${provider.redirectTo} για δοκιμή` : ""}.`
          : "Ο email provider δεν έχει ρυθμιστεί: οι απαντήσεις διαβάζονται, διορθώνονται και αντιγράφονται, αλλά δεν στέλνονται. Συμπληρώστε τα SMTP_* και MAIL_FROM στο .env."}
      </p>

      {error && <div className="error-state" role="alert">{error}</div>}
      {notice && <p className="bunkering-notice" role="status">{notice}</p>}

      {voyageOffers.length === 0 ? (
        <div className="empty-state">
          <p>Δεν υπάρχουν προσφορές καυσίμου για πλοία που είναι σε ταξίδι.</p>
          <p className="muted">
            Η «Προσομοίωση προσφορών προμηθευτών» φέρνει τέσσερις προσφορές για το MV Aegean Star και τις αναλύει. Επεξεργαστείτε
            πρώτα την καθυστέρηση στο Ρότερνταμ στα Εισερχόμενα: χωρίς αυτό το περιθώριο το πλοίο δεν προλαβαίνει να ανεφοδιαστεί
            και κάθε προσφορά σταματά στον έλεγχο χρόνου.
          </p>
          <button className="btn btn-primary" onClick={handleSimulate} disabled={simulating}>Προσομοίωση προσφορών προμηθευτών</button>
        </div>
      ) : (
        <>
          {urgentQuotes.length > 0 && (
            <div className="urgent-banner" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              {urgentQuotes.map(({ o, c }) => (
                <span key={o.recommendationId}>
                  {o.supplier.name} ({o.port.name}): η τιμή ισχύει, {c!.text}.
                </span>
              ))}
            </div>
          )}

          <div className="bunkering-grid">
            <section className="whatif" aria-labelledby="whatif-title">
              <p className="label" id="whatif-title">Τι θα γινόταν αν</p>
              <label className="whatif__field">
                <span>Ναύλος (charter rate) <strong>{usd(assumptions.charterUsdPerDay)}/ημέρα</strong></span>
                <input type="range" min={5000} max={60000} step={500} value={assumptions.charterUsdPerDay} onChange={(e) => setCharter(Number(e.target.value))} />
              </label>
              <label className="whatif__field">
                <span>Ποσότητα <strong>{assumptions.stemQtyT.toLocaleString("en-US")} t</strong></span>
                <input type="range" min={300} max={1500} step={50} value={assumptions.stemQtyT} onChange={(e) => setStemQty(Number(e.target.value))} />
              </label>
              <fieldset className="whatif__field whatif__urgency">
                <legend>Επείγον (πόσο κοστίζει μια ώρα καθυστέρησης)</legend>
                {(["LOW", "NORMAL", "HIGH"] as Urgency[]).map((u) => (
                  <label key={u} className={urgency === u ? "seg seg--active" : "seg"}>
                    <input type="radio" name="urgency" value={u} checked={urgency === u} onChange={() => setUrgency(u)} />
                    {URGENCY_LABEL[u]}
                  </label>
                ))}
              </fieldset>
              <label className="whatif__check">
                <input type="checkbox" checked={etsEnabled} onChange={(e) => setEtsEnabled(e.target.checked)} />
                EU ETS στο επιπλέον CO₂ της παράκαμψης
              </label>
              {etsEnabled && (
                <label className="whatif__field">
                  <span>Τιμή EUA <strong>€{etsPrice}/t CO₂</strong></span>
                  <input type="range" min={20} max={150} step={1} value={etsPrice} onChange={(e) => setEtsPrice(Number(e.target.value))} />
                </label>
              )}
              <button
                className="btn whatif__reset"
                onClick={() => { setCharter(null); setStemQty(null); setUrgency(DEFAULT_TCO.urgency); setEtsEnabled(DEFAULT_TCO.etsEnabled); setEtsPrice(null); }}
              >
                Επαναφορά
              </button>
              <p className="whatif__help">
                Credit is valued at {DEFAULT_TCO.financeRatePct}%/yr against {DEFAULT_TCO.standardPaymentDays} days; each reliability
                point below 10 adds {DEFAULT_TCO.reliabilityPctPerPoint}% of the fuel bill.
              </p>
            </section>

            <section className="advice" aria-labelledby="advice-title">
              <p className="label" id="advice-title">Σύσταση</p>
              <p className="advice__headline">{explanation.headline}</p>
              {explanation.reasons.length > 0 && (
                <ul className="advice__reasons">
                  {explanation.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {explanation.warnings.map((w) => <p key={w} className="advice__warning">{w}</p>)}
              {legacy.length > 0 && (
                <p className="advice__warning">{legacy.length} παλαιότερες προσφορές επεξεργάστηκαν πριν υπάρξει η σύγκριση και δεν περιλαμβάνονται.</p>
              )}
              <div className="advice__ai">
                <button className="btn" onClick={handleAskAi} disabled={ai.busy || rows.length === 0}>
                  <Sparkles size={14} aria-hidden="true" />
                  {ai.busy ? "Ερώτηση…" : `Ρωτήστε το AI (${meta?.llmProvider ?? "…"})`}
                </button>
                <span className="muted">Μία κλήση στο μοντέλο με αυτά τα νούμερα· το κείμενο πάνω δεν χρειάζεται καμία.</span>
              </div>
              {ai.text && <p className="advice__ai-text">{ai.text}</p>}
              {ai.error && <div className="error-state" role="alert">{ai.error}</div>}
            </section>
          </div>

          {rows.length > 0 && (
            <section aria-labelledby="compare-title">
              <p className="label" id="compare-title">Δίπλα-δίπλα</p>
              <div className="table-scroll">
                <table className="compare">
                  <thead>
                    <tr>
                      <th scope="col"><span className="visually-hidden">Στοιχείο</span></th>
                      {rows.map((r) => {
                        const o = byId.get(r.offer.id)!;
                        const isSel = o.recommendationId === selected?.recommendationId;
                        return (
                          <th key={r.offer.id} scope="col" className={r.rank === 1 && r.feasible ? "compare__best" : undefined}>
                            <button className={isSel ? "compare__pick compare__pick--active" : "compare__pick"} onClick={() => selectOffer(o.recommendationId)} aria-pressed={isSel}>
                              <span className="compare__rank">#{r.rank}{r.rank === 1 && r.feasible ? " καλύτερη" : ""}</span>
                              <span>{o.supplier.name}</span>
                              <span className="muted">{o.port.name}</span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr><th scope="row">Αξιοπιστία</th>{rows.map((r) => <td key={r.offer.id}>{r.offer.reliabilityScore}/10{r.offer.reliabilityKnown ? "" : " (εκτίμηση)"}</td>)}</tr>
                    <tr>
                      <th scope="row">Ισχύς τιμής</th>
                      {rows.map((r) => {
                        const c = countdown(r.offer.terms.quoteFirmUntil, now);
                        return (
                          <td key={r.offer.id} className={c ? `countdown countdown--${c.level}` : undefined}>
                            {c ? <><Clock size={12} aria-hidden="true" /> {c.text}</> : "—"}
                          </td>
                        );
                      })}
                    </tr>
                    <tr><th scope="row">Τιμή στο χαρτί</th>{rows.map((r) => <td key={r.offer.id}>{perT(r.offer.planInput.offer.priceUsdPerT)}/t</td>)}</tr>
                    <tr><th scope="row">Barging</th>{rows.map((r) => <td key={r.offer.id}>{bargingText(byId.get(r.offer.id)!)}</td>)}</tr>
                    <tr><th scope="row">Πληρωμή</th>{rows.map((r) => <td key={r.offer.id}>{r.offer.terms.paymentDays === null ? "δεν αναφέρεται" : r.offer.terms.paymentDays === 0 ? "προπληρωμή" : `${r.offer.terms.paymentDays} μέρες`}</td>)}</tr>
                    <tr><th scope="row">Barge</th>{rows.map((r) => <td key={r.offer.id}>{r.screen.delayHours > 0 ? `${r.screen.delayHours} h μετά την άφιξη` : "με την άφιξη"}</td>)}</tr>
                    <tr><th scope="row">Ποσότητα</th>{rows.map((r) => <td key={r.offer.id}>{r.qtyT.toLocaleString("en-US")} t</td>)}</tr>
                    {breakdownKeys.map((k) => (
                      (k !== "etsUsd" || etsEnabled) && (
                        <tr key={k} className="compare__cost"><th scope="row">{TCO_LABELS[k]}</th>{rows.map((r) => <td key={r.offer.id}>{cell(r, k)}</td>)}</tr>
                      )
                    ))}
                    <tr className="compare__total"><th scope="row">Σύνολο</th>{rows.map((r) => <td key={r.offer.id}>{r.totalUsd === null ? "—" : usd(r.totalUsd)}</td>)}</tr>
                    <tr className="compare__total"><th scope="row">Συνολικό κόστος ανά τόνο</th>{rows.map((r) => <td key={r.offer.id}>{r.effectiveUsdPerT === null ? "—" : `${perT(r.effectiveUsdPerT)}/t`}</td>)}</tr>
                    <tr>
                      <th scope="row">Κατάσταση</th>
                      {rows.map((r) => {
                        const o = byId.get(r.offer.id)!;
                        return (
                          <td key={r.offer.id}>
                            {o.status === "APPROVED"
                              ? "Έγινε αποδοχή"
                              : o.status === "REJECTED"
                                ? o.rejectReason?.startsWith(NOT_TAKEN_PREFIX) ? "Δεν επιλέχθηκε (προτιμήθηκε άλλη)" : "Απορρίφθηκε"
                                : !r.screen.passed
                              ? `Δεν αναλύθηκε: χρειάζεται ${r.screen.neededHours.toFixed(1)} h, υπάρχουν ${Math.max(0, r.screen.slackHours).toFixed(1)} h`
                                : r.feasible
                                  ? "Χωράει στο πρόγραμμα"
                                  : "Χάνει την πρόσδεση ή τη λήξη"}
                            {r.flags.length > 0 && <span className="compare__flags">{r.flags.join("; ")}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              {accepted && (
                <p className="bunkering-notice">
                  Έγινε αποδοχή της {accepted.supplier.name} ({accepted.port.name}). Μία απόφαση ανά πλοίο: οι άλλες επιλογές για το{" "}
                  {accepted.voyage.vesselName} έκλεισαν, αλλά μπορείτε ακόμα να τους στείλετε μια ευγενική άρνηση. Αναιρέστε την
                  έγκριση στις Ενέργειες για να επιλέξετε ξανά.
                </p>
              )}
            </section>
          )}

          {selected && (
            <section className="offer-detail" aria-labelledby="detail-title">
              <p className="label" id="detail-title">
                {selected.supplier.name} · {selected.fuelGrade ?? "καύσιμο"} στο {selected.port.name} · {selected.voyage.vesselName}
              </p>
              <p className="offer-detail__rationale">{selected.rationale}</p>
              {selected.terms.lines.length > 1 && (
                <p className="muted">
                  Προσφέρεται επίσης:{" "}
                  {selected.terms.lines.slice(1).map((l) => `${l.fuelGrade} ${l.qtyMinT ?? "?"}–${l.qtyMaxT ?? "?"} t στα $${l.priceUsdPerT}/t`).join(", ")}{" "}
                  (η σύγκριση γίνεται μόνο στο {selected.terms.lines[0].fuelGrade}).
                </p>
              )}

              {selected.plan && (
                <div className="offer-detail__route">
                  <RouteSketch plan={selected.plan} portName={selected.port.name} />
                  <div className="offer-detail__screen">
                    <p className="label">Έλεγχος χρόνου</p>
                    <p>
                      Χρειάζεται {selected.plan.screen.neededHours.toFixed(1)} h ({selected.plan.screen.bunkeringHours.toFixed(1)} h ανεφοδιασμός
                      {selected.plan.screen.delayHours > 0 ? ` + ${selected.plan.screen.delayHours.toFixed(1)} h αναμονή barge` : ""} +{" "}
                      {selected.plan.screen.detourHours.toFixed(1)} h παράκαμψη) έναντι {Math.max(0, selected.plan.screen.slackHours).toFixed(1)} h
                      περιθωρίου του πλοίου ως την πρόσδεση στο {selected.voyage.destPortName} (+{Math.round(selected.plan.screen.toleranceHours * 60)} min
                      ανοχή): {selected.plan.screen.passed ? "αναλύθηκε." : "σταμάτησε εδώ, χωρίς περαιτέρω ανάλυση."}
                    </p>
                    {selected.plan.input.delays.map((d) => <p key={d.note} className="muted">Καθυστέρηση: {d.note}</p>)}
                    <p className="muted">Θέση πλοίου κατά την ανάλυση: {selected.plan.input.shipPosition.lat.toFixed(2)}°, {selected.plan.input.shipPosition.lon.toFixed(2)}° · {selected.plan.input.offRouteNm.toFixed(1)} nm από τη διαδρομή.</p>
                  </div>
                </div>
              )}

              {selected.plan && selected.plan.options.length > 0 && (
                <div className="options">
                  {selected.plan.options.map((o) => (
                    <OptionCard key={o.key} option={o} offer={selected} chosen={selected.chosenOption === o.key} />
                  ))}
                </div>
              )}
              {assumptions.stemQtyT !== defaultStem && (
                <p className="muted">Οι επιλογές και οι απαντήσεις παρακάτω είναι για τους {defaultStem.toLocaleString("en-US")} t με τους οποίους αναλύθηκε η προσφορά· ο πίνακας πάνω χρησιμοποιεί την ποσότητα του «τι θα γινόταν αν».</p>
              )}

              <p className="label offer-detail__drafts-label">Απαντήσεις προς {selected.email.fromAddr}</p>
              <EmailDraftEditor
                drafts={selected.drafts}
                provider={provider}
                onChanged={refresh}
                closedBecause={selected.rejectReason?.startsWith(NOT_TAKEN_PREFIX) ? selected.rejectReason : null}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
