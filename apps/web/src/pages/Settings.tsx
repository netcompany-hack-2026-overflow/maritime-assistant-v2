import { useEffect, useState } from "react";
import { ciiReductionFactor, etsPhaseInForYear } from "@maritime/shared";
import { api, type MetaResponse } from "../lib/api.js";
import "./Settings.css";

const EXAMPLE_SAVING_T = 10;
const YEAR = new Date().getUTCFullYear();

const eur = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

interface PriceFormProps {
  title: string;
  help: string;
  fieldLabel: string;
  unit: string;
  saved: number;
  max: number;
  preview: (value: number) => React.ReactNode;
  onSave: (value: number) => Promise<string>;
}

function PriceForm({ title, help, fieldLabel, unit, saved, max, preview, onSave }: PriceFormProps) {
  const [value, setValue] = useState(String(saved));
  const [savedValue, setSavedValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed < max;
  const dirty = valid && parsed !== savedValue;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError(`Enter a price between 0 and ${max} ${unit}.`);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await onSave(parsed));
      setSavedValue(parsed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit} noValidate>
      <h2 className="settings-card__title">{title}</h2>
      <p className="settings-card__help">{help}</p>
      <label className="settings-field">
        <span>{fieldLabel}</span>
        <div className="settings-field__input">
          <span aria-hidden="true">€</span>
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={max - 1}
            step="any"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setMessage(null);
            }}
            aria-invalid={!valid}
          />
          <span aria-hidden="true">/ t</span>
        </div>
      </label>
      {valid && <p className="settings-card__preview">{preview(parsed)}</p>}
      {error && <div className="error-state" role="alert">{error}</div>}
      {message && <div className="settings-card__ok" role="status">{message}</div>}
      <div className="settings-card__actions">
        <button className="btn btn-primary" type="submit" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function repricedMessage(n: number): string {
  return n > 0 ? `Saved. ${n} pending recommendation${n === 1 ? "" : "s"} recalculated at the new price.` : "Saved.";
}

export function Settings() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getMeta(), api.getSettings()])
      .then(([m, s]) => {
        setMeta(m);
        setUpdatedAt(s.updatedAt);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page page--settings">
        <div className="loading-state" role="status">Loading settings…</div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="page page--settings">
        <div className="error-state" role="alert">{error ?? "Could not load settings."}</div>
      </div>
    );
  }

  const phaseIn = Math.round(etsPhaseInForYear(YEAR) * 100);

  return (
    <div className="page page--settings">
      <p className="label">Settings</p>

      <PriceForm
        title="Fuel price"
        help="Turns fuel saved into euros on every scenario. Pending recommendations are recalculated when you save; approved and rejected ones keep the price they were decided at."
        fieldLabel="Bunker price (VLSFO), € per tonne"
        unit="€/t"
        saved={meta.fuelPriceEurPerT}
        max={5000}
        preview={(p) => (
          <>
            At this price, saving {EXAMPLE_SAVING_T} t of fuel is worth <strong>{eur.format(EXAMPLE_SAVING_T * p)}</strong>.
          </>
        )}
        onSave={async (p) => {
          const res = await api.updateSettings({ fuelPriceEurPerT: p });
          setUpdatedAt(res.settings.updatedAt);
          return repricedMessage(res.repricedRecommendations);
        }}
      />

      <PriceForm
        title="EU carbon price (EUA)"
        help={`Each scenario's CO₂ is priced as EU ETS allowances: tonnes CO₂ × share covered × EUA price. For ${YEAR} shipping surrenders allowances for ${phaseIn}% of its emissions (2024: 40%, 2025: 70%, from 2026: 100%), on 100% of voyages between EU/EEA ports and 50% of voyages into or out of the EU.`}
        fieldLabel="EUA price, € per tonne CO₂"
        unit="€/t"
        saved={meta.euaPriceEurPerT}
        max={1000}
        preview={(p) => (
          <>
            1 t of fuel (≈ {meta.co2Factor} t CO₂) on an intra-EU voyage costs{" "}
            <strong>{eur.format(meta.co2Factor * p * etsPhaseInForYear(YEAR))}</strong> in allowances.
          </>
        )}
        onSave={async (p) => {
          const res = await api.updateSettings({ euaPriceEurPerT: p });
          setUpdatedAt(res.settings.updatedAt);
          return repricedMessage(res.repricedRecommendations);
        }}
      />

      <section className="settings-card">
        <h2 className="settings-card__title">Data sources</h2>
        <dl className="settings-status">
          <div>
            <dt>Weather</dt>
            <dd>
              {meta.weatherProvider === "open-meteo"
                ? meta.weatherError
                  ? `Open-Meteo unreachable (${meta.weatherError}); using offline mock weather`
                  : "Open-Meteo Marine API: wave height and ocean currents, hourly forecast"
                : "Offline mock (WEATHER_PROVIDER=mock)"}
            </dd>
          </div>
          <div>
            <dt>Live AIS</dt>
            <dd>
              {!meta.ais.enabled
                ? "Off. Add AISSTREAM_API_KEY to .env (never commit it) and restart the API."
                : meta.ais.trackedMmsi.length === 0
                  ? "Key set. Link a vessel's MMSI from its panel on the Fleet page."
                  : `${meta.ais.connected ? "Connected" : "Reconnecting"} · ${meta.ais.trackedMmsi.length} vessel(s) · ${meta.ais.messagesReceived} position reports${meta.ais.lastError ? ` · last error: ${meta.ais.lastError}` : ""}`}
            </dd>
          </div>
          <div>
            <dt>CII {YEAR}</dt>
            <dd>
              Required CII is {ciiReductionFactor(YEAR)}% below the 2019 reference line (MEPC.400(83): 13.625% in 2027 rising to 21.5% in 2030).
            </dd>
          </div>
        </dl>
        {updatedAt && <p className="settings-card__meta">Prices last changed {new Date(updatedAt).toLocaleString()}</p>}
      </section>
    </div>
  );
}
