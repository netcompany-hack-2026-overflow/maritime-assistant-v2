import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import "./Settings.css";

const EXAMPLE_SAVING_T = 10;

const eur = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function Settings() {
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSavedPrice(s.fuelPriceEurPerT);
        setPrice(String(s.fuelPriceEurPerT));
        setUpdatedAt(s.updatedAt);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const parsed = Number(price);
  const valid = price.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed < 5000;
  const dirty = valid && parsed !== savedPrice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError("Enter a fuel price between 0 and 5000 €/t.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updateSettings({ fuelPriceEurPerT: parsed });
      setSavedPrice(res.settings.fuelPriceEurPerT);
      setUpdatedAt(res.settings.updatedAt);
      setMessage(
        res.repricedRecommendations > 0
          ? `Saved. ${res.repricedRecommendations} pending recommendation${
              res.repricedRecommendations === 1 ? "" : "s"
            } recalculated at the new price.`
          : "Saved."
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page page--settings">
        <div className="loading-state" role="status">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="page page--settings">
      <p className="label">Settings</p>

      <form className="settings-card" onSubmit={handleSubmit} noValidate>
        <h2 className="settings-card__title">Fuel price</h2>
        <p className="settings-card__help">
          Used to turn fuel saved into euros on every speed recommendation. Pending recommendations
          are recalculated when you save; approved and rejected ones keep the price they were
          decided at.
        </p>

        <label className="settings-field">
          <span>Bunker price (VLSFO), € per tonne</span>
          <div className="settings-field__input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              max={4999}
              step="any"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setMessage(null);
              }}
              aria-invalid={!valid}
            />
            <span aria-hidden="true">/ t</span>
          </div>
        </label>

        {valid && (
          <p className="settings-card__preview">
            At this price, saving {EXAMPLE_SAVING_T} t of fuel is worth{" "}
            <strong>{eur.format(EXAMPLE_SAVING_T * parsed)}</strong>.
          </p>
        )}

        {error && <div className="error-state" role="alert">{error}</div>}
        {message && <div className="settings-card__ok" role="status">{message}</div>}

        <div className="settings-card__actions">
          <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          {updatedAt && (
            <span className="settings-card__meta">
              Last changed {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
