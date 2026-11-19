import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import "./SavingsTile.css";

interface Totals {
  count: number;
  pending: number;
  fuelT: number;
  costEur: number;
  co2T: number;
}

const POLL_MS = 5000;

/** Fleet-wide running total of what approved JIT recommendations have saved. */
export function SavingsTile() {
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getRecommendations()
        .then((recs) => {
          if (cancelled) return;
          const approved = recs.filter((r) => r.status === "APPROVED");
          setTotals({
            count: approved.length,
            pending: recs.filter((r) => r.status === "PENDING").length,
            fuelT: approved.reduce((s, r) => s + r.fuelSavedT, 0),
            costEur: approved.reduce((s, r) => s + r.costSavedEur, 0),
            co2T: approved.reduce((s, r) => s + r.co2SavedT, 0),
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!totals) return null;

  return (
    <section className="savings-tile" aria-labelledby="savings-title">
      <h2 id="savings-title" className="label">
        Εξοικονόμηση ως τώρα
      </h2>
      <dl className="savings-tile__grid">
        <div>
          <dt>Καύσιμο</dt>
          <dd>
            {totals.fuelT.toFixed(1)}
            <span> t</span>
          </dd>
        </div>
        <div>
          <dt>Κόστος</dt>
          <dd>
            €{Math.round(totals.costEur).toLocaleString("en-US")}
          </dd>
        </div>
        <div>
          <dt>CO₂</dt>
          <dd>
            {totals.co2T.toFixed(1)}
            <span> t</span>
          </dd>
        </div>
      </dl>
      <p className="savings-tile__foot">
        {totals.count === 0
          ? "Δεν υπάρχουν ακόμα εγκεκριμένες ενέργειες."
          : `Από ${totals.count === 1 ? "μία εγκεκριμένη ενέργεια" : `${totals.count} εγκεκριμένες ενέργειες`}.`}{" "}
        {totals.pending > 0 && (
          <Link to="/actions">
            {totals.pending} σε αναμονή για έλεγχο →
          </Link>
        )}
      </p>
    </section>
  );
}
