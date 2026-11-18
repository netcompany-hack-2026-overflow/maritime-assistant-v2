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
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const [rate, setRate] = useState("");
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
        setSavedRate(s.usdEurRate);
        setRate(String(s.usdEurRate));
        setUpdatedAt(s.updatedAt);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const parsed = Number(price);
  const priceValid = price.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed < 5000;
  const parsedRate = Number(rate);
  const rateValid = rate.trim() !== "" && Number.isFinite(parsedRate) && parsedRate >= 0.5 && parsedRate <= 2;
  const valid = priceValid && rateValid;
  const dirty = valid && (parsed !== savedPrice || parsedRate !== savedRate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError(
        !priceValid ? "Enter a fuel price between 0 and 5000 €/t." : "Enter a USD → EUR rate between 0.5 and 2."
      );
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updateSettings({ fuelPriceEurPerT: parsed, usdEurRate: parsedRate });
      setSavedPrice(res.settings.fuelPriceEurPerT);
      setSavedRate(res.settings.usdEurRate);
      setUpdatedAt(res.settings.updatedAt);
      setMessage(
        res.repricedRecommendations > 0
          ? `Saved. ${res.repricedRecommendations} pending recommendation${
              res.repricedRecommendations === 1 ? "" : "s"
            } recalculated at the new prices.`
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
        <h2 className="settings-card__title">Fuel prices</h2>
        <p className="settings-card__help">
          Used to turn fuel into euros on every recommendation, and as the price a bunker offer has
          to beat. Pending recommendations are recalculated when you save; approved and rejected
          ones keep the prices they were decided at.
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
              aria-invalid={!priceValid}
            />
            <span aria-hidden="true">/ t</span>
          </div>
        </label>

        <label className="settings-field">
          <span>USD → EUR rate (bunker offers are quoted in dollars)</span>
          <div className="settings-field__input">
            <span aria-hidden="true">$1 =</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.5}
              max={2}
              step="any"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                setMessage(null);
              }}
              aria-invalid={!rateValid}
            />
            <span aria-hidden="true">€</span>
          </div>
        </label>

        {priceValid && (
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
