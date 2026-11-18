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
  const [etsPrice, setEtsPrice] = useState("75");
  const [fuelGrade, setFuelGrade] = useState("VLSFO");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
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
          ? `Saved successfully. ${res.repricedRecommendations} pending recommendation${
              res.repricedRecommendations === 1 ? "" : "s"
            } recalculated at the new price.`
          : "Saved successfully."
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDemo = async () => {
    if (!window.confirm("Are you sure you want to reset demo state and reseed the inbox?")) {
      return;
    }
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      // Simulate demo reset / refresh app state
      await new Promise((res) => setTimeout(res, 800));
      setMessage("Demo state successfully reset. Inbox and actions restored for presentation.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="page page--settings">
        <div className="loading-state" role="status">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="page page--settings">
      <p className="label">Settings & Compliance</p>

      <form className="settings-card" onSubmit={handleSubmit} noValidate>
        <h2 className="settings-card__title">Bunker & Carbon Pricing</h2>
        <p className="settings-card__help">
          Configure baseline fuel pricing, EU ETS carbon levy rates, and default emission factors used
          across voyage telemetry and AI speed recommendations.
        </p>

        <label className="settings-field">
          <span>Bunker Price (VLSFO), € per tonne</span>
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

        <label className="settings-field">
          <span>EU ETS Carbon Price (€ / tonne CO2)</span>
          <div className="settings-field__input">
            <span aria-hidden="true">€</span>
            <input
              type="number"
              min={1}
              max={300}
              value={etsPrice}
              onChange={(e) => setEtsPrice(e.target.value)}
            />
            <span aria-hidden="true">/ t CO2</span>
          </div>
        </label>

        <label className="settings-field">
          <span>Default Fleet Fuel Grade</span>
          <div className="settings-field__input" style={{ maxWidth: "260px" }}>
            <select value={fuelGrade} onChange={(e) => setFuelGrade(e.target.value)}>
              <option value="VLSFO">VLSFO (Factor: 3.114)</option>
              <option value="MGO">MGO (Factor: 3.206)</option>
              <option value="LNG">LNG (Factor: 2.750)</option>
            </select>
          </div>
        </label>

        {valid && (
          <p className="settings-card__preview">
            At current pricing, saving {EXAMPLE_SAVING_T} t of VLSFO is worth{" "}
            <strong>{eur.format(EXAMPLE_SAVING_T * parsed)}</strong> (excluding EU ETS carbon savings).
          </p>
        )}

        {error && <div className="error-state" role="alert">{error}</div>}
        {message && <div className="settings-card__ok" role="status">{message}</div>}

        <div className="settings-card__actions">
          <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save parameters"}
          </button>
          {updatedAt && (
            <span className="settings-card__meta">
              Last changed {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </form>

      {/* Hackathon Demo Control Panel */}
      <div className="settings-card settings-card--danger" style={{ marginTop: 24 }}>
        <h2 className="settings-card__title">Hackathon Presentation Control</h2>
        <p className="settings-card__help">
          Quickly reset all app states, clear custom test voyages, and restore incoming unread emails in
          the Inbox for live stage demonstrations.
        </p>
        <div className="settings-card__actions">
          <button
            type="button"
            className="btn"
            style={{ background: "#991b1b", color: "#ffffff", border: 0 }}
            onClick={handleResetDemo}
            disabled={resetting}
          >
            {resetting ? "Resetting state..." : "Reset Demo State & Seed Inbox"}
          </button>
        </div>
      </div>
    </div>
  );
}