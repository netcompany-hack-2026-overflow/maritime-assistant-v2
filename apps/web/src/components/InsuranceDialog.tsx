import { useEffect, useState } from "react";
import { RefreshCw, Send, ShieldAlert, ShieldCheck, X } from "lucide-react";
import {
  WAR_COVER_PERIOD_DAYS,
  type CrewZoneCategory,
  type VoyageInsuranceDTO,
  type WarRiskExposure,
  type WarThreat,
} from "@maritime/shared";
import { api } from "../lib/api.js";
import { utc } from "../lib/format.js";
import "./InsuranceDialog.css";

interface Props {
  voyageId: string;
  title: string;
  onClose: (changed: boolean) => void;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toLocaleString("el-GR", { maximumFractionDigits: 3 })}%`;
const days = (n: number) => n.toLocaleString("el-GR", { maximumFractionDigits: 1 });
const pos = (p: { lat: number; lon: number }) =>
  `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? "Β" : "Ν"} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? "Α" : "Δ"}`;

const THREAT: Record<WarThreat, string> = { WAR: "πόλεμος", PIRACY: "πειρατεία", TERRORISM: "τρομοκρατία" };

const CREW_CATEGORY: Record<CrewZoneCategory, { label: string; rule: string }> = {
  WOA: {
    label: "Warlike Operations Area",
    rule: "μπόνους ίσο με τον βασικό μισθό, ελάχιστο 5 ημέρες· διπλή αποζημίωση θανάτου/αναπηρίας· δικαίωμα άρνησης",
  },
  HRA: { label: "High Risk Area", rule: "μπόνους για τις πραγματικές ημέρες· διπλή αποζημίωση· δικαίωμα άρνησης" },
  ERZ: { label: "Extended Risk Zone", rule: "μπόνους μόνο την ημέρα επίθεσης (στα λιμάνια Ισραήλ/Λιβάνου: για τις ημέρες στο λιμάνι)" },
};

function statusText(e: WarRiskExposure): string {
  if (e.status === "INSIDE") return "Μέσα στην περιοχή τώρα";
  if (e.status === "PASSED") return "Έχει βγει από την περιοχή";
  const h = e.hoursToEntry ?? 0;
  return h < 48 ? `Μπαίνει σε ${Math.round(h)} ώρες` : `Μπαίνει σε ${days(h / 24)} ημέρες`;
}

/** The voyage's war-risk insurance: the policy issued at departure, what changed, the AI analysis and the notice. */
export function InsuranceDialog({ voyageId, title, onClose }: Props) {
  const [data, setData] = useState<VoyageInsuranceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<Record<string, string>>({});
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const load = (d: VoyageInsuranceDTO) => {
    setData(d);
    setTo(d.notice?.to ?? "");
    setSubject(d.notice?.subject ?? "");
    setBody(d.notice?.body ?? "");
  };

  useEffect(() => {
    api
      .getVoyageInsurance(voyageId)
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [voyageId]);

  const run = async (key: string, fn: () => Promise<VoyageInsuranceDTO>, done?: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      load(await fn());
      setChanged(true);
      if (done) setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cur = data?.current;
  const noticeDirty =
    data?.notice != null && (to !== data.notice.to || subject !== data.notice.subject || body !== data.notice.body);
  const cp = data?.charterParty;

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && !busy && onClose(changed)}>
      <div className="modal ins-dialog" role="dialog" aria-modal="true" aria-labelledby="ins-dialog-title">
        <div className="ins-dialog__head">
          <div>
            <p className="label">Ασφάλιση ταξιδιού</p>
            <h2 id="ins-dialog-title" className="ins-dialog__title">
              {title}
            </h2>
          </div>
          <button className="vessel-drawer__close" onClick={() => onClose(changed)} aria-label="Κλείσιμο">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="loading-state" role="status">
            Έλεγχος διαδρομής και ανάλυση…
          </div>
        ) : !data || !cur ? (
          <div className="error-state" role="alert">
            {error ?? "Η ασφάλιση δεν φορτώθηκε."}
          </div>
        ) : (
          <>
            {cur.needsEndorsement ? (
              <div className="ins-verdict ins-verdict--risk">
                <ShieldAlert size={20} aria-hidden="true" />
                <div>
                  <strong>Χρειάζεται πρόσθετη ασφάλιση πολέμου.</strong>{" "}
                  Η διαδρομή περνά από {cur.exposures.length === 1 ? "περιοχή" : `${cur.exposures.length} περιοχές`} της λίστας JWC (
                  {cur.circular.ref}).{" "}
                  {cur.insideNow
                    ? `Το πλοίο είναι τώρα μέσα (${cur.currentAreaLabel}).`
                    : cur.notifyBy
                      ? `Δήλωση στους ασφαλιστές πολέμου πριν τις ${utc(cur.notifyBy)}.`
                      : "Το πλοίο έχει ήδη βγει από την περιοχή."}
                </div>
              </div>
            ) : (
              <div className="ins-verdict ins-verdict--ok">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <strong>Κανονική κάλυψη.</strong> Η διαδρομή δεν περνά από περιοχή της λίστας JWC ({cur.circular.ref},{" "}
                  {cur.circular.date}). Δεν χρειάζεται επασφάλιστρο ούτε δήλωση.
                </div>
              </div>
            )}

            {(data.change.extraPeriods !== 0 || data.change.newAreas.length > 0) && (
              <div className="ins-change" role="status">
                <strong>Άλλαξε από την αναχώρηση.</strong>
                <ul>
                  {data.change.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p>
                  {data.change.extraPeriods > 0
                    ? `Χρειάζεται επέκταση της κάλυψης κατά ${data.change.extraPeriods * WAR_COVER_PERIOD_DAYS} ημέρες`
                    : "Η κάλυψη μειώνεται"}{" "}
                  ({data.change.extraPremiumUsd >= 0 ? "+" : "−"}
                  {usd(Math.abs(data.change.extraPremiumUsd))} στο επασφάλιστρο). Ενημερώστε τους ασφαλιστές.
                </p>
              </div>
            )}

            <section className="ins-section">
              <div className="ins-section__head">
                <h3>Ανάλυση</h3>
                <span className="ins-muted">
                  {data.analysis.source === "llm" ? `AI (${data.analysis.provider})` : "πρότυπο χωρίς AI"} · {utc(data.analysis.generatedAt)}
                </span>
                <button
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() => run("analysis", () => api.regenerateInsuranceAnalysis(voyageId), "Η ανάλυση ξαναγράφτηκε.")}
                >
                  <RefreshCw size={14} aria-hidden="true" /> {busy === "analysis" ? "Ανάλυση…" : "Νέα ανάλυση"}
                </button>
              </div>
              <p className="ins-analysis">{data.analysis.summary}</p>
            </section>

            <section className="ins-section">
              <h3>Ασφαλιστήριο ταξιδιού</h3>
              <dl className="ins-terms">
                <div>
                  <dt>Σκάφος και μηχανές (H&amp;M)</dt>
                  <dd>Συμφωνημένη αξία {usd(data.hullValueUsd)}. Ισχύει κανονικά· δεν καλύπτει κινδύνους πολέμου.</dd>
                </div>
                <div>
                  <dt>P&amp;I</dt>
                  <dd>Ισχύει κανονικά. Οι ευθύνες από πόλεμο καλύπτονται από την ασφάλιση πολέμου (έως την αξία του σκάφους).</dd>
                </div>
                <div>
                  <dt>Ασφάλιση πολέμου</dt>
                  <dd>
                    Παγκόσμια, εκτός των περιοχών της λίστας JWC.{" "}
                    {cur.needsEndorsement
                      ? `Για ${cur.exposures.length === 1 ? "την περιοχή" : "τις περιοχές"} παρακάτω χρειάζεται πρόσθετη πράξη με επασφάλιστρο.`
                      : "Καμία πρόσθετη πράξη για αυτό το ταξίδι."}
                  </dd>
                </div>
              </dl>
            </section>

            {cur.exposures.map((e, i) => {
              const draft = quoteDraft[e.rateZoneId] ?? "";
              return (
                <section className="ins-section ins-endorsement" key={`${e.areaId}-${e.enterNm}`}>
                  <div className="ins-section__head">
                    <h3>
                      Πρόσθετη πράξη {i + 1}: {e.label}
                    </h3>
                    <span className={`ins-pill ins-pill--${e.status.toLowerCase()}`}>{statusText(e)}</span>
                  </div>
                  <dl className="ins-terms">
                    <div>
                      <dt>Περιοχή JWC</dt>
                      <dd>{e.jwcName}</dd>
                    </div>
                    <div>
                      <dt>Είσοδος</dt>
                      <dd>
                        {e.startsInside ? "Από την αναχώρηση" : `${utc(e.enterAt)} στο ${pos(e.enterPosition)}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Έξοδος</dt>
                      <dd>
                        {utc(e.exitAt)}
                        {e.endsInside ? " (μετά την αναμονή και τις εργασίες στο λιμάνι προορισμού)" : ` στο ${pos(e.exitPosition)}`}
                      </dd>
                    </div>
                    {e.zones.length > 0 && (
                      <div>
                        <dt>Τμήματα</dt>
                        <dd>{e.zones.map((z) => `${z.label}: ${days(z.days)} ημ.`).join(" · ")}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Ημέρες στην περιοχή</dt>
                      <dd>
                        {days(e.sailingDays)} πλεύση
                        {e.portStayDays > 0 ? ` + ${days(e.portStayDays)} στο λιμάνι` : ""} = <strong>{days(e.daysInArea)}</strong> ημέρες
                        με {cur.speedKn.toFixed(1)} kn
                      </dd>
                    </div>
                    <div>
                      <dt>Κάλυψη</dt>
                      <dd>
                        <strong>
                          {e.periods} × {WAR_COVER_PERIOD_DAYS} = {e.coveredDays} ημέρες
                        </strong>
                        {e.periods > 1
                          ? ` (οι ${days(e.daysInArea)} ημέρες ξεπερνούν τις ${WAR_COVER_PERIOD_DAYS}: χρειάζεται ${e.periods}η περίοδος).`
                          : ` (περιθώριο ${days(e.coveredDays - e.daysInArea)} ημέρες· αν η παραμονή ξεπεράσει τις ${WAR_COVER_PERIOD_DAYS}, χρειάζεται 2η περίοδος).`}
                      </dd>
                    </div>
                    <div>
                      <dt>Ποσοστό</dt>
                      <dd>
                        {pct(e.ratePct)} της αξίας ανά {WAR_COVER_PERIOD_DAYS} ημέρες ({e.rateZoneLabel}).{" "}
                        <span className="ins-muted">
                          {e.quoted
                            ? "Προσφορά broker."
                            : `${e.rateBasis.source}${e.rateBasis.assumption ? " (υπόθεση)" : ""}.`}
                        </span>
                        <span className="ins-quote">
                          <label>
                            Προσφορά broker (%)
                            <input
                              type="number"
                              min="0.001"
                              max="25"
                              step="0.01"
                              placeholder={String(e.ratePct)}
                              value={draft}
                              onChange={(ev) => setQuoteDraft((q) => ({ ...q, [e.rateZoneId]: ev.target.value }))}
                            />
                          </label>
                          <button
                            className="btn btn-sm"
                            disabled={busy !== null || !(Number(draft) > 0)}
                            onClick={() =>
                              run("quote", () => api.setInsuranceQuote(voyageId, e.rateZoneId, Number(draft)), "Το επασφάλιστρο ξαναϋπολογίστηκε με την προσφορά.")
                            }
                          >
                            Εφαρμογή
                          </button>
                          {e.quoted && (
                            <button
                              className="btn btn-sm"
                              disabled={busy !== null}
                              onClick={() => run("quote", () => api.setInsuranceQuote(voyageId, e.rateZoneId, null))}
                            >
                              Τιμή αγοράς
                            </button>
                          )}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Επασφάλιστρο (AP)</dt>
                      <dd>
                        {usd(data.hullValueUsd)} × {pct(e.ratePct)} × {e.periods} = <strong>{usd(e.premiumUsd)}</strong>
                      </dd>
                    </div>
                    <div>
                      <dt>Κίνδυνοι</dt>
                      <dd>{e.threats.map((t) => THREAT[t]).join(", ")}</dd>
                    </div>
                    <div>
                      <dt>Πριν την είσοδο</dt>
                      <dd>
                        <ul className="ins-list">
                          <li>Δήλωση στους ασφαλιστές πολέμου και συμφωνία του επασφαλίστρου. Χωρίς δήλωση δεν υπάρχει κάλυψη μέσα στην περιοχή.</li>
                          {e.reporting.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                </section>
              );
            })}

            {cur.needsEndorsement && (
              <section className="ins-section">
                <h3>Πρόσθετες καλύψεις</h3>
                <dl className="ins-terms">
                  <div>
                    <dt>Απαγωγή και λύτρα (K&amp;R)</dt>
                    <dd>
                      {cur.kidnapAndRansomAdvised
                        ? "Προτείνεται: στη διαδρομή υπάρχει κίνδυνος πειρατείας με απαγωγές. Ξεχωριστό συμβόλαιο, ανά ταξίδι ή ετήσιο."
                        : "Δεν χρειάζεται για ό,τι απομένει από τη διαδρομή."}
                    </dd>
                  </div>
                  <div>
                    <dt>Απώλεια μισθώματος από πόλεμο</dt>
                    <dd>Προαιρετική: καλύπτει τις ημέρες που το πλοίο κρατείται ή κατάσχεται. Ζητήστε τιμή μαζί με το επασφάλιστρο.</dd>
                  </div>
                </dl>
              </section>
            )}

            {cur.crew.length > 0 && (
              <section className="ins-section">
                <h3>Πλήρωμα (IBF)</h3>
                <div className="table-scroll">
                  <table className="ins-table">
                    <thead>
                      <tr>
                        <th>Ζώνη</th>
                        <th>Κατηγορία</th>
                        <th>Ημέρες</th>
                        <th>Ημέρες μπόνους</th>
                        <th>Κόστος</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cur.crew.map((c) => (
                        <tr key={`${c.zoneId}-${c.enterAt}`}>
                          <td>{c.label}</td>
                          <td title={CREW_CATEGORY[c.category].rule}>{CREW_CATEGORY[c.category].label}</td>
                          <td>{days(c.days)}</td>
                          <td>{c.bonusDays}</td>
                          <td>{usd(c.bonusUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="ins-list ins-muted">
                  {[...new Set(cur.crew.map((c) => c.category))].map((cat) => (
                    <li key={cat}>
                      {CREW_CATEGORY[cat].label}: {CREW_CATEGORY[cat].rule}.
                    </li>
                  ))}
                  <li>
                    {cur.crewCount} άτομα × {usd(cur.crewWageUsdPerDay)}/ημέρα μέσος βασικός μισθός (υπόθεση).
                  </li>
                </ul>
              </section>
            )}

            {cur.needsEndorsement && (
              <section className="ins-section">
                <h3>Ποιος πληρώνει</h3>
                <p className="ins-text">
                  {!cp
                    ? "Δεν υπάρχει ναυλοσύμφωνο στο ταξίδι: προσθέστε το για να φανεί αν οι ναυλωτές επιστρέφουν το επασφάλιστρο."
                    : !cp.warRisksClause.present
                      ? "Το ναυλοσύμφωνο δεν έχει ρήτρα πολέμου: αν δεν συμφωνηθεί κάτι άλλο, το επασφάλιστρο μένει στον πλοιοκτήτη."
                      : cp.warRisksClause.additionalPremiumForCharterers
                        ? `Κατά το ναυλοσύμφωνο (${cp.warRisksClause.name}) οι ναυλωτές${cp.chartererName ? ` (${cp.chartererName})` : ""} επιστρέφουν το επασφάλιστρο${cp.warRisksClause.crewBonusForCharterers ? " και το μπόνους του πληρώματος" : ""}, μαζί με την επόμενη πληρωμή ναύλου ή στην εκφόρτωση.`
                        : `Το ναυλοσύμφωνο έχει ρήτρα πολέμου (${cp.warRisksClause.name}) αλλά δεν λέει ποιος πληρώνει το επασφάλιστρο.`}
                </p>
                {cp?.warRisksClause.text && <blockquote className="ins-clause">{cp.warRisksClause.text}</blockquote>}
                <p className="ins-total">
                  Επασφάλιστρο {usd(cur.totals.premiumUsd)} + μπόνους πληρώματος {usd(cur.totals.crewBonusUsd)} ={" "}
                  <strong>{usd(cur.totals.totalUsd)}</strong>
                </p>
              </section>
            )}

            {data.notice && (
              <section className="ins-section">
                <div className="ins-section__head">
                  <h3>Δήλωση στους ασφαλιστές πολέμου</h3>
                  <span className={`ins-pill ins-pill--${data.notice.status === "SENT" ? "sent" : "draft"}`}>
                    {data.notice.status === "SENT" ? `Στάλθηκε ${utc(data.notice.sentAt)}` : data.notice.edited ? "Πρόχειρο (διορθωμένο)" : "Πρόχειρο"}
                  </span>
                </div>
                <p className="ins-muted">Γράφεται στα αγγλικά, όπως πάει στον broker. Διορθώστε ό,τι χρειάζεται και πατήστε Αποστολή.</p>
                <label className="ins-field">
                  Προς
                  <input value={to} onChange={(e) => setTo(e.target.value)} disabled={data.notice.status === "SENT"} />
                </label>
                <label className="ins-field">
                  Θέμα
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={data.notice.status === "SENT"} />
                </label>
                <label className="ins-field">
                  Κείμενο
                  <textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} disabled={data.notice.status === "SENT"} />
                </label>
                {data.notice.lastError && (
                  <div className="error-state" role="alert">
                    {data.notice.lastError}
                  </div>
                )}
                {data.notice.status === "DRAFT" && (
                  <div className="ins-actions">
                    <button
                      className="btn"
                      disabled={busy !== null || !noticeDirty}
                      onClick={() => run("save", () => api.saveInsuranceNotice(voyageId, { to, subject, body }), "Αποθηκεύτηκε.")}
                    >
                      Αποθήκευση
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null || !data.canSend}
                      title={data.cannotSendReason ?? undefined}
                      onClick={() =>
                        run(
                          "send",
                          async () => {
                            if (noticeDirty) await api.saveInsuranceNotice(voyageId, { to, subject, body });
                            return api.sendInsuranceNotice(voyageId);
                          },
                          "Η δήλωση στάλθηκε."
                        )
                      }
                    >
                      <Send size={14} aria-hidden="true" /> {busy === "send" ? "Αποστολή…" : "Αποστολή"}
                    </button>
                  </div>
                )}
                {!data.canSend && data.cannotSendReason && data.notice.status === "DRAFT" && (
                  <p className="ins-muted">{data.cannotSendReason}</p>
                )}
                {data.notice.deliveredTo && data.notice.deliveredTo !== data.notice.to && (
                  <p className="ins-muted">Δοκιμαστική λειτουργία: παραδόθηκε στο {data.notice.deliveredTo}.</p>
                )}
                {data.sentNotices.length > 0 && data.notice.status === "DRAFT" && (
                  <p className="ins-muted">
                    Προηγούμενη δήλωση: «{data.sentNotices[0].subject}», {utc(data.sentNotices[0].sentAt)}. Οι όροι άλλαξαν από τότε.
                  </p>
                )}
              </section>
            )}

            {message && (
              <p className="ins-message" role="status">
                {message}
              </p>
            )}
            {error && (
              <div className="error-state" role="alert">
                {error}
              </div>
            )}

            <details className="ins-section ins-assumptions">
              <summary>Υποθέσεις και πηγές</summary>
              <ul className="ins-list">
                {cur.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
                <li>
                  Λίστα περιοχών JWC:{" "}
                  <a href="https://lmalloyds.com/specialist-areas/underwriting/listed-areas/" target="_blank" rel="noreferrer">
                    LMA Listed Areas
                  </a>
                  . Ζώνες πληρώματος:{" "}
                  <a href="https://imec.org.uk/the-international-bargaining-forum-ibf/ibf-risk-areas" target="_blank" rel="noreferrer">
                    IBF risk areas
                  </a>
                  .
                </li>
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
