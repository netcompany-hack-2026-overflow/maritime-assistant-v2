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
  if (ms <= 0) return { text: "lapsed: ask for a re-quote", level: "lapsed" };
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h} h ${String(m).padStart(2, "0")} min left` : `${m}:${String(s).padStart(2, "0")} left`;
  // Short-fuse quotes ("firm 10 mins") warn from the moment they arrive.
  return { text, level: ms < 15 * 60_000 ? "soon" : "ok" };
}

function bargingText(o: BunkerOfferDTO): string {
  const t = o.terms;
  if (t.bargingType === "LUMP_SUM") return `${usd(t.bargingUsd ?? 0)} lump sum`;
  if (t.bargingType === "PER_MT") return `$${t.bargingUsd}/t`;
  if (t.bargingType === "INCLUDED") return "included";
  return "not stated";
}

const WAYPOINT_LABEL: Record<BunkerWaypoint["kind"], (port: string, dest: string) => string> = {
  SHIP: () => "Ship now",
  TURN_OFF: () => "Leave the planned route",
  BUNKER_ARRIVE: (port) => `Arrive ${port}`,
  BUNKER_DEPART: (port) => `Leave ${port}`,
  REJOIN: () => "Back on the planned route",
  DESTINATION: (_, dest) => `Arrive ${dest}`,
};

const OPTION_TITLE: Record<BunkerOption["key"], string> = {
  ECO: "Bunker, then slow down to arrive just in time",
  KEEP_SPEED: "Bunker and keep the current speed (time in hand)",
};

function OptionCard({ option, offer, chosen }: { option: BunkerOption; offer: BunkerOfferDTO; chosen: boolean }) {
  const c = option.calc;
  const stop = c.portHours + (c.delayHours ?? 0);
  const speedText =
    c.speedAfterBunkerKn !== undefined && Math.abs(c.speedAfterBunkerKn - c.speedBunkerKn) >= 0.05
      ? `${c.speedBunkerKn.toFixed(1)} kn to ${offer.port.name}, then ${c.speedAfterBunkerKn.toFixed(1)} kn`
      : `${c.speedBunkerKn.toFixed(1)} kn`;
  return (
    <div className={chosen ? "option-card option-card--chosen" : "option-card"}>
      <div className="option-card__head">
        <p className="option-card__title">{OPTION_TITLE[option.key]}</p>
        {chosen && <span className="chip chip--ok">chosen</span>}
        <span className={c.verdict === "WORTH_IT" ? "chip chip--ok" : "chip chip--no"}>
          {c.verdict === "WORTH_IT" ? "pays off" : "doesn't pay off"}
        </span>
      </div>
      <dl className="option-card__facts">
        <div><dt>Proposed speed</dt><dd>{speedText} <span className="muted">(now {c.v0.toFixed(1)} kn)</span></dd></div>
        <div><dt>Detour</dt><dd>{c.detourNm.toFixed(0)} nm out and back</dd></div>
        <div><dt>Time at {offer.port.name}</dt><dd>{stop.toFixed(1)} h{c.delayHours ? ` (incl. ${c.delayHours.toFixed(1)} h barge wait)` : ""}</dd></div>
        <div><dt>Stem</dt><dd>{c.qtyT.toLocaleString("en-US")} t at ${c.priceUsdPerT}/t</dd></div>
        <div><dt>Extra fuel vs. not bunkering</dt><dd>{c.extraFuelT.toFixed(1)} t ({c.extraCo2T.toFixed(1)} t CO₂)</dd></div>
        <div><dt>Time in hand at the berth</dt><dd>{c.waitHoursBunker.toFixed(1)} h{c.lateHours > 0 ? `, ${Math.round(c.lateHours * 60)} min late (within tolerance)` : ""}</dd></div>
        <div className="option-card__net"><dt>Net vs. our €{c.refPriceEurPerT}/t fuel</dt><dd>{eur(c.netEur)}</dd></div>
        {option.breakEvenUsdPerT !== null && (
          <div><dt>Breaks even at</dt><dd>${option.breakEvenUsdPerT.toFixed(2)}/t</dd></div>
        )}
      </dl>
      <table className="waypoints">
        <caption className="visually-hidden">Reshaped route</caption>
        <thead>
          <tr><th scope="col">Route</th><th scope="col">Time (UTC)</th><th scope="col">Speed</th></tr>
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
  const [etsPrice, setEtsPrice] = useState(DEFAULT_TCO.etsPriceEurPerT);
  const [ai, setAi] = useState<{ text: string; busy: boolean; error: string | null }>({ text: "", busy: false, error: null });
  const now = useNow();

  const refresh = () =>
    Promise.all([api.getBunkerOffers(), api.getMeta()])
      .then(([list, m]) => {
        setOffers(list);
        setMeta(m);
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
  const open = useMemo(() => voyageOffers.filter((o) => o.status !== "REJECTED"), [voyageOffers]);
  const declined = voyageOffers.filter((o) => o.status === "REJECTED");
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
      setNotice(`${res.length} supplier quotes arrived and were analysed${matched.length < res.length ? ` (${res.length - matched.length} matched no ship underway)` : ""}.`);
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
        <div className="loading-state" role="status">Loading offers…</div>
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
          <p className="label">Bunkering</p>
          <h2 className="bunkering-head__title">Supplier offers, compared on total cost</h2>
        </div>
        <div className="bunkering-head__actions">
          {voyages.length > 1 && (
            <label className="bunkering-head__select">
              <span className="visually-hidden">Ship</span>
              <select value={voyageId ?? ""} onChange={(e) => { setVoyageId(e.target.value); setSelectedId(null); setCharter(null); }}>
                {voyages.map((v) => (
                  <option key={v.id} value={v.id}>{v.vesselName} · {v.originPortName} → {v.destPortName}</option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary" onClick={handleSimulate} disabled={simulating}>
            {simulating ? "Reading quotes…" : "Simulate supplier quotes"}
          </button>
        </div>
      </div>
      <p className={provider?.configured ? "provider provider--ok" : "provider"}>
        {provider?.configured
          ? `Replies are sent from ${provider.from}${provider.redirectTo ? `, redirected to ${provider.redirectTo} for testing` : ""}.`
          : "Email provider not set up: replies can be read, edited and copied, but not sent. Fill in the SMTP_* and MAIL_FROM settings in .env."}
      </p>

      {error && <div className="error-state" role="alert">{error}</div>}
      {notice && <p className="bunkering-notice" role="status">{notice}</p>}

      {voyageOffers.length === 0 ? (
        <div className="empty-state">
          <p>No fuel offers yet.</p>
          <p className="muted">
            "Simulate supplier quotes" drops four quotes for MV Aegean Star into the inbox and analyses them. Process the
            Rotterdam berth delay in the Inbox first: without that slack the ship can't stop to bunker, and every offer
            stops at the time check.
          </p>
          <button className="btn btn-primary" onClick={handleSimulate} disabled={simulating}>Simulate supplier quotes</button>
        </div>
      ) : (
        <>
          {urgentQuotes.length > 0 && (
            <div className="urgent-banner" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              {urgentQuotes.map(({ o, c }) => (
                <span key={o.recommendationId}>
                  {o.supplier.name} ({o.port.name}): price firm {c!.text}.
                </span>
              ))}
            </div>
          )}

          <div className="bunkering-grid">
            <section className="whatif" aria-labelledby="whatif-title">
              <p className="label" id="whatif-title">What if</p>
              <label className="whatif__field">
                <span>Charter rate <strong>{usd(assumptions.charterUsdPerDay)}/day</strong></span>
                <input type="range" min={5000} max={60000} step={500} value={assumptions.charterUsdPerDay} onChange={(e) => setCharter(Number(e.target.value))} />
              </label>
              <label className="whatif__field">
                <span>Stem <strong>{assumptions.stemQtyT.toLocaleString("en-US")} t</strong></span>
                <input type="range" min={300} max={1500} step={50} value={assumptions.stemQtyT} onChange={(e) => setStemQty(Number(e.target.value))} />
              </label>
              <fieldset className="whatif__field whatif__urgency">
                <legend>Urgency (how much a delay hour costs)</legend>
                {(["LOW", "NORMAL", "HIGH"] as Urgency[]).map((u) => (
                  <label key={u} className={urgency === u ? "seg seg--active" : "seg"}>
                    <input type="radio" name="urgency" value={u} checked={urgency === u} onChange={() => setUrgency(u)} />
                    {u.charAt(0) + u.slice(1).toLowerCase()}
                  </label>
                ))}
              </fieldset>
              <label className="whatif__check">
                <input type="checkbox" checked={etsEnabled} onChange={(e) => setEtsEnabled(e.target.checked)} />
                Count EU ETS on the detour's extra CO₂
              </label>
              {etsEnabled && (
                <label className="whatif__field">
                  <span>EUA price <strong>€{etsPrice}/t CO₂</strong></span>
                  <input type="range" min={20} max={150} step={1} value={etsPrice} onChange={(e) => setEtsPrice(Number(e.target.value))} />
                </label>
              )}
              <button
                className="btn whatif__reset"
                onClick={() => { setCharter(null); setStemQty(null); setUrgency(DEFAULT_TCO.urgency); setEtsEnabled(false); setEtsPrice(DEFAULT_TCO.etsPriceEurPerT); }}
              >
                Reset
              </button>
              <p className="whatif__help">
                Credit is valued at {DEFAULT_TCO.financeRatePct}%/yr against {DEFAULT_TCO.standardPaymentDays} days; each reliability
                point below 10 adds {DEFAULT_TCO.reliabilityPctPerPoint}% of the fuel bill.
              </p>
            </section>

            <section className="advice" aria-labelledby="advice-title">
              <p className="label" id="advice-title">Recommendation</p>
              <p className="advice__headline">{explanation.headline}</p>
              {explanation.reasons.length > 0 && (
                <ul className="advice__reasons">
                  {explanation.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {explanation.warnings.map((w) => <p key={w} className="advice__warning">{w}</p>)}
              {legacy.length > 0 && (
                <p className="advice__warning">{legacy.length} older offer(s) were processed before the comparison existed and aren't in it.</p>
              )}
              <div className="advice__ai">
                <button className="btn" onClick={handleAskAi} disabled={ai.busy || rows.length === 0}>
                  <Sparkles size={14} aria-hidden="true" />
                  {ai.busy ? "Asking…" : `Ask the AI (${meta?.llmProvider ?? "…"})`}
                </button>
                <span className="muted">One model call with these numbers; the text above needs none.</span>
              </div>
              {ai.text && <p className="advice__ai-text">{ai.text}</p>}
              {ai.error && <div className="error-state" role="alert">{ai.error}</div>}
            </section>
          </div>

          {rows.length > 0 && (
            <section aria-labelledby="compare-title">
              <p className="label" id="compare-title">Side by side</p>
              <div className="table-scroll">
                <table className="compare">
                  <thead>
                    <tr>
                      <th scope="col"><span className="visually-hidden">Item</span></th>
                      {rows.map((r) => {
                        const o = byId.get(r.offer.id)!;
                        const isSel = o.recommendationId === selected?.recommendationId;
                        return (
                          <th key={r.offer.id} scope="col" className={r.rank === 1 && r.feasible ? "compare__best" : undefined}>
                            <button className={isSel ? "compare__pick compare__pick--active" : "compare__pick"} onClick={() => selectOffer(o.recommendationId)} aria-pressed={isSel}>
                              <span className="compare__rank">#{r.rank}{r.rank === 1 && r.feasible ? " best" : ""}</span>
                              <span>{o.supplier.name}</span>
                              <span className="muted">{o.port.name}</span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr><th scope="row">Reliability</th>{rows.map((r) => <td key={r.offer.id}>{r.offer.reliabilityScore}/10{r.offer.reliabilityKnown ? "" : " (assumed)"}</td>)}</tr>
                    <tr>
                      <th scope="row">Price firm</th>
                      {rows.map((r) => {
                        const c = countdown(r.offer.terms.quoteFirmUntil, now);
                        return (
                          <td key={r.offer.id} className={c ? `countdown countdown--${c.level}` : undefined}>
                            {c ? <><Clock size={12} aria-hidden="true" /> {c.text}</> : "—"}
                          </td>
                        );
                      })}
                    </tr>
                    <tr><th scope="row">Price on paper</th>{rows.map((r) => <td key={r.offer.id}>{perT(r.offer.planInput.offer.priceUsdPerT)}/t</td>)}</tr>
                    <tr><th scope="row">Barging</th>{rows.map((r) => <td key={r.offer.id}>{bargingText(byId.get(r.offer.id)!)}</td>)}</tr>
                    <tr><th scope="row">Payment</th>{rows.map((r) => <td key={r.offer.id}>{r.offer.terms.paymentDays === null ? "not stated" : r.offer.terms.paymentDays === 0 ? "cash in advance" : `${r.offer.terms.paymentDays} days`}</td>)}</tr>
                    <tr><th scope="row">Barge</th>{rows.map((r) => <td key={r.offer.id}>{r.screen.delayHours > 0 ? `${r.screen.delayHours} h after arrival` : "on arrival"}</td>)}</tr>
                    <tr><th scope="row">Stem</th>{rows.map((r) => <td key={r.offer.id}>{r.qtyT.toLocaleString("en-US")} t</td>)}</tr>
                    {breakdownKeys.map((k) => (
                      (k !== "etsUsd" || etsEnabled) && (
                        <tr key={k} className="compare__cost"><th scope="row">{TCO_LABELS[k]}</th>{rows.map((r) => <td key={r.offer.id}>{cell(r, k)}</td>)}</tr>
                      )
                    ))}
                    <tr className="compare__total"><th scope="row">Total</th>{rows.map((r) => <td key={r.offer.id}>{r.totalUsd === null ? "—" : usd(r.totalUsd)}</td>)}</tr>
                    <tr className="compare__total"><th scope="row">All-in per tonne</th>{rows.map((r) => <td key={r.offer.id}>{r.effectiveUsdPerT === null ? "—" : `${perT(r.effectiveUsdPerT)}/t`}</td>)}</tr>
                    <tr>
                      <th scope="row">Status</th>
                      {rows.map((r) => {
                        const o = byId.get(r.offer.id)!;
                        return (
                          <td key={r.offer.id}>
                            {!r.screen.passed
                              ? `Not analysed: needs ${r.screen.neededHours.toFixed(1)} h, has ${Math.max(0, r.screen.slackHours).toFixed(1)} h`
                              : o.status === "APPROVED"
                                ? "Accepted"
                                : r.feasible
                                  ? "Fits the schedule"
                                  : "Misses berth or expiry"}
                            {r.flags.length > 0 && <span className="compare__flags">{r.flags.join("; ")}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              {declined.length > 0 && (
                <p className="muted compare__declined">Declined: {declined.map((o) => `${o.supplier.name} (${o.port.name})`).join(", ")}.</p>
              )}
            </section>
          )}

          {selected && (
            <section className="offer-detail" aria-labelledby="detail-title">
              <p className="label" id="detail-title">
                {selected.supplier.name} · {selected.fuelGrade ?? "fuel"} at {selected.port.name} · {selected.voyage.vesselName}
              </p>
              <p className="offer-detail__rationale">{selected.rationale}</p>
              {selected.terms.lines.length > 1 && (
                <p className="muted">
                  Also quoted:{" "}
                  {selected.terms.lines.slice(1).map((l) => `${l.fuelGrade} ${l.qtyMinT ?? "?"}–${l.qtyMaxT ?? "?"} t at $${l.priceUsdPerT}/t`).join(", ")}{" "}
                  (compared on {selected.terms.lines[0].fuelGrade} only).
                </p>
              )}

              {selected.plan && (
                <div className="offer-detail__route">
                  <RouteSketch plan={selected.plan} portName={selected.port.name} />
                  <div className="offer-detail__screen">
                    <p className="label">Time check</p>
                    <p>
                      Needs {selected.plan.screen.neededHours.toFixed(1)} h ({selected.plan.screen.bunkeringHours.toFixed(1)} h alongside
                      {selected.plan.screen.delayHours > 0 ? ` + ${selected.plan.screen.delayHours.toFixed(1)} h barge wait` : ""} +{" "}
                      {selected.plan.screen.detourHours.toFixed(1)} h detour) against {Math.max(0, selected.plan.screen.slackHours).toFixed(1)} h
                      the ship has to spare before its {selected.voyage.destPortName} berth (+{Math.round(selected.plan.screen.toleranceHours * 60)} min
                      tolerance): {selected.plan.screen.passed ? "analysed." : "stopped here, no further analysis."}
                    </p>
                    {selected.plan.input.delays.map((d) => <p key={d.note} className="muted">Delay: {d.note}</p>)}
                    <p className="muted">Ship position at analysis: {selected.plan.input.shipPosition.lat.toFixed(2)}°, {selected.plan.input.shipPosition.lon.toFixed(2)}° · {selected.plan.input.offRouteNm.toFixed(1)} nm off the route.</p>
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
                <p className="muted">The options and replies below are for the {defaultStem.toLocaleString("en-US")} t stem the offer was analysed with; the table above uses your what-if stem.</p>
              )}

              <p className="label offer-detail__drafts-label">Replies to {selected.email.fromAddr}</p>
              <EmailDraftEditor drafts={selected.drafts} provider={provider} onChanged={refresh} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
