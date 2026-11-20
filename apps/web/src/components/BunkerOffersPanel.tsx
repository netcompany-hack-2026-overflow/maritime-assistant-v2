import { useEffect, useMemo, useState } from "react";
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
} from "@maritime/shared";
import { api, type MetaResponse } from "../lib/api.js";
import { NOT_TAKEN_PREFIX } from "../lib/labels.js";
import { RouteSketch } from "./RouteSketch.js";
import { EmailDraftEditor } from "./EmailDraftEditor.js";
import "./BunkerOffersPanel.css";

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

export interface BunkerOffersPanelProps {
  /** Every fuel offer for one ship, decided or not, so the choice can be explained. */
  offers: BunkerOfferDTO[];
  meta: MetaResponse | null;
  /** Offer to show in detail first (just approved, or opened from a link). */
  focusOfferId: string | null;
  /** The ship's other open options outside the fuel offers (a speed change). */
  otherOpenOptions: number;
  onChanged: () => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
}

/** The fuel offers for one ship: total-cost comparison, route options, the decision and the replies. */
export function BunkerOffersPanel({
  offers,
  meta,
  focusOfferId,
  otherOpenOptions,
  onChanged,
  onApprove,
  onReject,
  onUndo,
}: BunkerOffersPanelProps) {
  const voyage = offers[0].voyage;
  const [selectedId, setSelectedId] = useState<string | null>(focusOfferId);
  useEffect(() => {
    if (focusOfferId) setSelectedId(focusOfferId);
  }, [focusOfferId]);
  // The EUA price from Settings (the one the speed scenarios use too).
  const etsPrice = meta?.euaPriceEurPerT ?? DEFAULT_TCO.etsPriceEurPerT;
  const [ai, setAi] = useState<{ text: string; busy: boolean; error: string | null }>({ text: "", busy: false, error: null });
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const now = useNow();

  const accepted = offers.find((o) => o.status === "APPROVED") ?? null;
  const openOffers = offers.filter((o) => o.status === "PENDING").length;
  const defaultStem = offers.find((o) => o.plan)?.plan?.input.stemQtyT ?? 800;

  // The voyage's own figures: the ship's charter rate, the quantity the offers were analysed for, EUA from Settings.
  const assumptions: TcoAssumptions = {
    ...DEFAULT_TCO,
    stemQtyT: defaultStem,
    charterUsdPerDay: voyage.charterRateUsdPerDay ?? 15_000,
    etsPriceEurPerT: etsPrice,
  };

  const tcoOffers = useMemo(() => offers.map(tcoOfferFromDTO).filter((o): o is TcoOffer => o !== null), [offers]);
  const rows = useMemo(
    () => compareOffers(tcoOffers, assumptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tcoOffers, assumptions.stemQtyT, assumptions.charterUsdPerDay, etsPrice]
  );
  const explanation = useMemo(() => explainComparison(rows), [rows]);
  const byId = new Map(offers.map((o) => [o.recommendationId, o]));
  const selected =
    byId.get(selectedId ?? "") ?? accepted ?? (rows[0] ? byId.get(rows[0].offer.id) : undefined) ?? offers[0] ?? null;
  const legacy = offers.filter((o) => !o.plan);

  // The AI text describes the numbers it was given; drop it when they change.
  useEffect(
    () => setAi({ text: "", busy: false, error: null }),
    [voyage.id, assumptions.stemQtyT, assumptions.charterUsdPerDay, etsPrice]
  );
  // A half-written rejection belongs to the offer it was started on.
  useEffect(() => {
    setRejecting(false);
    setDecisionError(null);
  }, [selected?.recommendationId]);

  const urgentQuotes = offers
    .map((o) => ({ o, c: countdown(o.terms.quoteFirmUntil, now) }))
    .filter((x) => x.c && x.c.level !== "ok" && x.o.status === "PENDING");

  const handleAskAi = async () => {
    setAi({ text: "", busy: true, error: null });
    try {
      const res = await api.explainBunkerOffers(voyage.id, assumptions);
      setAi({ text: res.text, busy: false, error: null });
    } catch (e) {
      setAi({ text: "", busy: false, error: (e as Error).message });
    }
  };

  const decide = async (action: () => Promise<void>) => {
    setBusy(true);
    setDecisionError(null);
    try {
      await action();
      setRejecting(false);
      setRejectReason("");
    } catch (e) {
      setDecisionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const provider = meta?.emailProvider ?? null;
  const breakdownKeys = Object.keys(TCO_LABELS) as Array<keyof TcoBreakdown>;
  const cell = (r: TcoRow, k: keyof TcoBreakdown) => (r.breakdown ? usd(r.breakdown[k]) : "—");
  const closesOthers = openOffers - 1 + otherOpenOptions;
  const worthIt = selected?.calc.verdict === "WORTH_IT";

  return (
    <section className="bunker-panel" aria-label={`Προσφορές καυσίμου για ${voyage.vesselName}`}>
      <div className="bunker-panel__head">
        <p className="label">Προσφορές καυσίμου · {offers.length}</p>
        <h3 className="bunker-panel__title">Σύγκριση συνολικού κόστους</h3>
      </div>

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
        <section className="advice" aria-label="Σύσταση">
          <p className="label">Σύσταση</p>
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
          <p className="muted advice__assumptions">
            Με ναύλο {usd(assumptions.charterUsdPerDay)}/ημέρα, {assumptions.stemQtyT.toLocaleString("en-US")} t
            {assumptions.etsEnabled ? ` και EUA €${etsPrice}/t CO₂ στο επιπλέον CO₂ της παράκαμψης` : ""}. Η πίστωση αποτιμάται
            με {DEFAULT_TCO.financeRatePct}% τον χρόνο έναντι {DEFAULT_TCO.standardPaymentDays} ημερών· κάθε μονάδα αξιοπιστίας
            κάτω από το 10 προσθέτει {DEFAULT_TCO.reliabilityPctPerPoint}% του λογαριασμού καυσίμου.
          </p>
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
        <section aria-label="Δίπλα-δίπλα">
          <p className="label">Δίπλα-δίπλα · πατήστε μια στήλη για λεπτομέρειες</p>
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
                        <button className={isSel ? "compare__pick compare__pick--active" : "compare__pick"} onClick={() => setSelectedId(o.recommendationId)} aria-pressed={isSel}>
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
                  (k !== "etsUsd" || assumptions.etsEnabled) && (
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
                          ? "Εγκρίθηκε"
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
              Εγκρίθηκε η {accepted.supplier.name} ({accepted.port.name}). Μία απόφαση ανά πλοίο: οι άλλες επιλογές για το{" "}
              {voyage.vesselName} έκλεισαν, αλλά μπορείτε ακόμα να τους στείλετε μια ευγενική άρνηση. Αναιρέστε την έγκριση
              για να επιλέξετε ξανά.
            </p>
          )}
        </section>
      )}

      {selected && (
        <section className="offer-detail" aria-label={`${selected.supplier.name}, ${selected.port.name}`}>
          <p className="label">
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

          <div className="offer-decision">
            {selected.status === "PENDING" ? (
              <>
                {closesOthers > 0 && (
                  <p className="offer-decision__rule">
                    Μία απόφαση ανά πλοίο: η έγκριση κλείνει {closesOthers === 1 ? "την άλλη ανοιχτή επιλογή" : `τις άλλες ${closesOthers} ανοιχτές επιλογές`} για
                    το {voyage.vesselName}.
                  </p>
                )}
                {rejecting ? (
                  <div className="offer-decision__reject">
                    <textarea
                      aria-label="Αιτιολογία απόρριψης"
                      autoFocus
                      rows={2}
                      placeholder="π.χ. η τιμή λήγει πριν φτάσει το πλοίο…"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="offer-decision__buttons">
                      <button className="btn" onClick={() => setRejecting(false)} disabled={busy}>Ακύρωση</button>
                      <button
                        className="btn btn-primary"
                        onClick={() => decide(() => onReject(selected.recommendationId, rejectReason.trim()))}
                        disabled={busy || rejectReason.trim().length === 0}
                      >
                        Απόρριψη
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="offer-decision__buttons">
                    <button className={worthIt ? "btn btn-primary" : "btn"} onClick={() => decide(() => onApprove(selected.recommendationId))} disabled={busy}>
                      Έγκριση: {selected.supplier.name}, {selected.port.name}
                    </button>
                    <button className={worthIt ? "btn" : "btn btn-primary"} onClick={() => setRejecting(true)} disabled={busy}>
                      Απόρριψη
                    </button>
                  </div>
                )}
                <p className="muted">Η έγκριση καταγράφει την απόφαση χωρίς να στείλει email. Η αποστολή μιας «Αποδοχής» παρακάτω εγκρίνει κι αυτή.</p>
              </>
            ) : selected.status === "APPROVED" ? (
              <div className="offer-decision__buttons">
                <p className="offer-decision__state offer-decision__state--ok">
                  Εγκρίθηκε{selected.decidedAt ? ` · ${new Date(selected.decidedAt).toLocaleString("el-GR")}` : ""}
                </p>
                <button className="btn" onClick={() => decide(() => onUndo(selected.recommendationId))} disabled={busy}>
                  Αναίρεση έγκρισης
                </button>
              </div>
            ) : (
              <p className="offer-decision__state">
                {selected.rejectReason?.startsWith(NOT_TAKEN_PREFIX)
                  ? selected.rejectReason
                  : `Απορρίφθηκε${selected.rejectReason ? `: ${selected.rejectReason}` : ""}`}
              </p>
            )}
            {decisionError && <div className="error-state" role="alert">{decisionError}</div>}
          </div>

          <p className="label offer-detail__drafts-label">Απαντήσεις προς {selected.email.fromAddr}</p>
          <p className={provider?.configured ? "provider provider--ok" : "provider"}>
            {provider?.configured
              ? `Στέλνονται από ${provider.from}${provider.redirectTo ? `, με ανακατεύθυνση στο ${provider.redirectTo} για δοκιμή` : ""}.`
              : "Ο email provider δεν έχει ρυθμιστεί: οι απαντήσεις διαβάζονται, διορθώνονται και αντιγράφονται, αλλά δεν στέλνονται. Συμπληρώστε τα SMTP_* και MAIL_FROM στο .env."}
          </p>
          <EmailDraftEditor
            drafts={selected.drafts}
            provider={provider}
            onChanged={onChanged}
            closedBecause={selected.rejectReason?.startsWith(NOT_TAKEN_PREFIX) ? selected.rejectReason : null}
          />
        </section>
      )}
    </section>
  );
}
