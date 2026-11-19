import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BunkerOfferDTO, ScenarioId } from "@maritime/shared";
import { api, type MetaResponse, type RecommendationRecord } from "../lib/api.js";
import { RecommendationCard } from "../components/RecommendationCard.js";
import { BunkerOffersPanel } from "../components/BunkerOffersPanel.js";
import "./Actions.css";

type Tab = "pending" | "history";

type ShipGroup = { kind: "ship"; voyageId: string; cards: RecommendationRecord[]; offers: BunkerOfferDTO[] };
type Item = { kind: "card"; rec: RecommendationRecord } | ShipGroup;

/**
 * One list of decisions. A ship with fuel offers is one group: its speed
 * change (if any) and its offers together, because approving one closes the
 * others. The group sits in "Σε αναμονή" while an offer is open and in
 * "Ιστορικό" once they are all decided.
 */
function buildItems(recs: RecommendationRecord[], offersByVoyage: Map<string, BunkerOfferDTO[]>, tab: Tab): Item[] {
  const items: Item[] = [];
  const groups = new Map<string, ShipGroup>();
  for (const rec of recs) {
    const shipOffers = offersByVoyage.get(rec.voyageId);
    const isOffer = shipOffers?.some((o) => o.recommendationId === rec.id) ?? false;
    const anyOpen = shipOffers?.some((o) => o.status === "PENDING") ?? false;
    const groupHere = shipOffers !== undefined && (tab === "pending" ? anyOpen : !anyOpen);
    if (!groupHere) {
      // An offer is shown inside its ship's group in the other tab.
      if (!isOffer) items.push({ kind: "card", rec });
      continue;
    }
    let group = groups.get(rec.voyageId);
    if (!group) {
      group = { kind: "ship", voyageId: rec.voyageId, cards: [], offers: shipOffers };
      groups.set(rec.voyageId, group);
      items.push(group);
    }
    if (!isOffer) group.cards.push(rec);
  }
  return items;
}

const contains = (item: Item, id: string) =>
  item.kind === "card" ? item.rec.id === id : item.cards.some((c) => c.id === id) || item.offers.some((o) => o.recommendationId === id);

function scrollToShip(voyageId: string) {
  requestAnimationFrame(() =>
    document.getElementById(`ship-${voyageId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  );
}

export function Actions() {
  const [params] = useSearchParams();
  const linkedOffer = params.get("offer");
  const [tab, setTab] = useState<Tab>("pending");
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [offers, setOffers] = useState<BunkerOfferDTO[]>([]);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Just-approved (or linked) item: shown first so its notice or reply is in view.
  const [focusId, setFocusId] = useState<string | null>(linkedOffer);
  const linkHandled = useRef(false);

  const refresh = async (): Promise<void> => {
    try {
      const [recs, list, m] = await Promise.all([api.getRecommendations(), api.getBunkerOffers(), api.getMeta()]);
      setRecommendations(recs);
      setOffers(list);
      setMeta(m);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  // A link to one offer (e.g. the old /bunkering?offer=…) opens the tab its ship is in.
  useEffect(() => {
    if (linkHandled.current || !linkedOffer || offers.length === 0) return;
    linkHandled.current = true;
    const offer = offers.find((o) => o.recommendationId === linkedOffer);
    if (!offer) return;
    const open = offers.some((o) => o.voyage.id === offer.voyage.id && o.status === "PENDING");
    setTab(open ? "pending" : "history");
    scrollToShip(offer.voyage.id);
  }, [linkedOffer, offers]);

  const offersByVoyage = useMemo(() => {
    const map = new Map<string, BunkerOfferDTO[]>();
    for (const o of offers) map.set(o.voyage.id, [...(map.get(o.voyage.id) ?? []), o]);
    return map;
  }, [offers]);

  const pending = recommendations.filter((r) => r.status === "PENDING");
  const history = recommendations.filter((r) => r.status !== "PENDING");
  const openPerVoyage = new Map<string, number>();
  for (const r of pending) openPerVoyage.set(r.voyageId, (openPerVoyage.get(r.voyageId) ?? 0) + 1);
  const offerIds = new Set(offers.map((o) => o.recommendationId));
  const openSpeedChanges = (voyageId: string) => pending.filter((r) => r.voyageId === voyageId && !offerIds.has(r.id)).length;

  const items = buildItems(tab === "pending" ? pending : history, offersByVoyage, tab);
  if (focusId) items.sort((a, b) => (contains(a, focusId) ? -1 : contains(b, focusId) ? 1 : 0));

  const handleApprove = async (id: string, scenarioId?: ScenarioId) => {
    await api.approveRecommendation(id, scenarioId);
    await refresh();
    setFocusId(id);
    setTab("history");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRefresh = async (id: string) => {
    await api.refreshRecommendation(id);
    await refresh();
  };

  const handleUndo = async (id: string) => {
    await api.undoApproval(id);
    await refresh();
  };

  const handleReject = async (id: string, reason: string) => {
    await api.rejectRecommendation(id, reason);
    await refresh();
  };

  const handleSimulate = async () => {
    setSimulating(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.simulateBunkerQuotes();
      await refresh();
      const matched = res.filter((r) => r.matchedVoyageId);
      setNotice(
        `Ήρθαν και αναλύθηκαν ${res.length} προσφορές καυσίμου${matched.length < res.length ? ` (${res.length - matched.length} δεν αντιστοιχούν σε πλοίο εν πλω)` : ""}.`
      );
      setTab("pending");
      setFocusId(null);
      if (matched[0]?.matchedVoyageId) scrollToShip(matched[0].matchedVoyageId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  // What the approved recommendations add up to (bunker calls count their extra fuel as negative).
  const approvedTotals = useMemo(
    () =>
      recommendations
        .filter((r) => r.status === "APPROVED")
        .reduce(
          (acc, r) => ({ count: acc.count + 1, fuel: acc.fuel + r.fuelSavedT, cost: acc.cost + r.costSavedEur, co2: acc.co2 + r.co2SavedT }),
          { count: 0, fuel: 0, cost: 0, co2: 0 }
        ),
    [recommendations]
  );

  const renderCard = (rec: RecommendationRecord) => (
    <RecommendationCard
      key={`${rec.id}:${rec.status}:${rec.scenarios?.generatedAt ?? ""}:${rec.outboundEmails?.length ?? 0}`}
      recommendation={rec}
      fuelPriceEurPerT={meta?.fuelPriceEurPerT ?? 600}
      onApprove={handleApprove}
      onRefresh={handleRefresh}
      onReject={handleReject}
      onUndo={handleUndo}
      alternatives={rec.status === "PENDING" ? (openPerVoyage.get(rec.voyageId) ?? 1) - 1 : 0}
    />
  );

  const renderShip = (group: ShipGroup) => {
    const v = group.offers[0].voyage;
    const speed = openSpeedChanges(group.voyageId);
    const openOffers = group.offers.filter((o) => o.status === "PENDING").length;
    const options = [
      speed > 0 ? (speed === 1 ? "μία αλλαγή ταχύτητας" : `${speed} αλλαγές ταχύτητας`) : null,
      openOffers > 0 ? (openOffers === 1 ? "μία προσφορά καυσίμου" : `${openOffers} προσφορές καυσίμου`) : null,
    ].filter(Boolean);
    return (
      <section key={`ship:${group.voyageId}`} id={`ship-${group.voyageId}`} className="ship-group" aria-label={v.vesselName}>
        <div className="ship-group__head">
          <p className="label">{v.vesselName}</p>
          <p className="ship-group__route">
            {v.originPortName} → {v.destPortName}
          </p>
          {tab === "pending" && speed + openOffers > 1 && (
            <p className="ship-group__rule">
              Μία απόφαση για αυτό το πλοίο: {options.join(" και ")}. Η έγκριση μίας κλείνει τις υπόλοιπες.
            </p>
          )}
        </div>
        {group.cards.map(renderCard)}
        <BunkerOffersPanel
          offers={group.offers}
          meta={meta}
          focusOfferId={focusId && group.offers.some((o) => o.recommendationId === focusId) ? focusId : null}
          otherOpenOptions={speed}
          onChanged={refresh}
          onApprove={(id) => handleApprove(id)}
          onReject={handleReject}
          onUndo={handleUndo}
        />
      </section>
    );
  };

  return (
    <div className="page page--actions">
      <div className="actions-head">
        <div className="actions-tabs" role="tablist" aria-label="Συστάσεις">
          <button
            className={tab === "pending" ? "actions-tab actions-tab--active" : "actions-tab"}
            onClick={() => setTab("pending")}
            role="tab"
            aria-selected={tab === "pending"}
          >
            Σε αναμονή{pending.length > 0 ? ` (${pending.length})` : ""}
          </button>
          <button
            className={tab === "history" ? "actions-tab actions-tab--active" : "actions-tab"}
            onClick={() => setTab("history")}
            role="tab"
            aria-selected={tab === "history"}
          >
            Ιστορικό{history.length > 0 ? ` (${history.length})` : ""}
          </button>
        </div>
        <div className="actions-head__side">
          {approvedTotals.count > 0 && (
            <p className="actions-impact">
              Από εγκεκριμένες:{" "}
              {approvedTotals.fuel >= 0
                ? `${approvedTotals.fuel.toFixed(1)} t καύσιμο λιγότερο`
                : `${Math.abs(approvedTotals.fuel).toFixed(1)} t επιπλέον καύσιμο`}{" "}
              · {approvedTotals.cost < 0 ? "−" : ""}€{Math.abs(Math.round(approvedTotals.cost)).toLocaleString("en-US")} καθαρό ·{" "}
              {approvedTotals.co2 >= 0
                ? `${approvedTotals.co2.toFixed(1)} t CO₂ λιγότερο`
                : `${Math.abs(approvedTotals.co2).toFixed(1)} t επιπλέον CO₂`}
            </p>
          )}
          <button className="btn" onClick={handleSimulate} disabled={simulating} title="Τέσσερις προσφορές προμηθευτών για το MV Aegean Star, για το demo">
            {simulating ? "Ανάγνωση προσφορών…" : "Προσομοίωση προσφορών καυσίμου"}
          </button>
        </div>
      </div>

      {notice && <p className="actions-notice" role="status">{notice}</p>}
      {error && <div className="error-state" role="alert">{error}</div>}

      {loading ? (
        <div className="loading-state" role="status">Φόρτωση ενεργειών…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          {tab === "pending" ? (
            <>
              <p>Δεν υπάρχουν συστάσεις σε αναμονή.</p>
              <p className="muted">
                Επεξεργαστείτε ένα email καθυστέρησης ή προσφοράς καυσίμου στα Εισερχόμενα, ή πατήστε «Προσομοίωση προσφορών
                καυσίμου». Για το demo, επεξεργαστείτε πρώτα την καθυστέρηση στο Ρότερνταμ: χωρίς αυτό το περιθώριο το MV Aegean
                Star δεν προλαβαίνει να ανεφοδιαστεί και κάθε προσφορά σταματά στον έλεγχο χρόνου.
              </p>
            </>
          ) : (
            "Δεν υπάρχουν ακόμα αποφασισμένες συστάσεις."
          )}
        </div>
      ) : (
        items.map((item) => (item.kind === "card" ? renderCard(item.rec) : renderShip(item)))
      )}
    </div>
  );
}
