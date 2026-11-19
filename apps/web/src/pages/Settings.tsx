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
      setError(`Δώστε τιμή μεταξύ 0 και ${max} ${unit}.`);
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
          {saving ? "Αποθήκευση…" : "Αποθήκευση"}
        </button>
      </div>
    </form>
  );
}

function repricedMessage(n: number): string {
  return n > 0
    ? `Αποθηκεύτηκε. ${n === 1 ? "Μία σύσταση σε αναμονή ξαναϋπολογίστηκε" : `${n} συστάσεις σε αναμονή ξαναϋπολογίστηκαν`} με τη νέα τιμή.`
    : "Αποθηκεύτηκε.";
}

export function Settings() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetDemo = async () => {
    if (
      !window.confirm(
        "Επαναφορά του demo; Διαγράφονται όλα τα emails, οι συστάσεις, οι απαντήσεις και τα ταξίδια, και ξαναφτιάχνονται από την αρχή με τα πλοία στη θέση εκκίνησης."
      )
    ) {
      return;
    }
    setResetting(true);
    setResetMessage(null);
    setResetError(null);
    try {
      const res = await api.resetDemo();
      setResetMessage(
        `Έγινε επαναφορά: ${res.voyages} ταξίδια σε εξέλιξη και ${res.queuedEmails} emails έτοιμα για «Προσομοίωση εισερχόμενου email».`
      );
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetting(false);
    }
  };

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
        <div className="loading-state" role="status">Φόρτωση ρυθμίσεων…</div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="page page--settings">
        <div className="error-state" role="alert">{error ?? "Δεν ήταν δυνατή η φόρτωση των ρυθμίσεων."}</div>
      </div>
    );
  }

  const phaseIn = Math.round(etsPhaseInForYear(YEAR) * 100);

  return (
    <div className="page page--settings">
      <p className="label">Ρυθμίσεις</p>

      <PriceForm
        title="Τιμή καυσίμου"
        help="Μετατρέπει το καύσιμο που γλιτώνεται σε ευρώ σε κάθε σενάριο. Οι συστάσεις σε αναμονή ξαναϋπολογίζονται με την αποθήκευση· οι εγκεκριμένες και οι απορριφθείσες κρατούν την τιμή με την οποία αποφασίστηκαν."
        fieldLabel="Τιμή bunker (VLSFO), € ανά τόνο"
        unit="€/t"
        saved={meta.fuelPriceEurPerT}
        max={5000}
        preview={(p) => (
          <>
            Με αυτή την τιμή, {EXAMPLE_SAVING_T} t καυσίμου που γλιτώνονται αξίζουν <strong>{eur.format(EXAMPLE_SAVING_T * p)}</strong>.
          </>
        )}
        onSave={async (p) => {
          const res = await api.updateSettings({ fuelPriceEurPerT: p });
          setUpdatedAt(res.settings.updatedAt);
          return repricedMessage(res.repricedRecommendations);
        }}
      />

      <PriceForm
        title="Τιμή άνθρακα ΕΕ (EUA)"
        help={`Το CO₂ κάθε σεναρίου τιμολογείται ως δικαιώματα EU ETS: τόνοι CO₂ × ποσοστό κάλυψης × τιμή EUA. Για το ${YEAR} η ναυτιλία παραδίδει δικαιώματα για το ${phaseIn}% των εκπομπών της (2024: 40%, 2025: 70%, από 2026: 100%), στο 100% των ταξιδιών μεταξύ λιμανιών ΕΕ/ΕΟΧ και στο 50% των ταξιδιών προς ή από την ΕΕ. Η ίδια τιμή χρησιμοποιείται και στη σύγκριση προσφορών καυσίμου.`}
        fieldLabel="Τιμή EUA, € ανά τόνο CO₂"
        unit="€/t"
        saved={meta.euaPriceEurPerT}
        max={1000}
        preview={(p) => (
          <>
            1 t καυσίμου (≈ {meta.co2Factor} t CO₂) σε ταξίδι εντός ΕΕ κοστίζει{" "}
            <strong>{eur.format(meta.co2Factor * p * etsPhaseInForYear(YEAR))}</strong> σε δικαιώματα.
          </>
        )}
        onSave={async (p) => {
          const res = await api.updateSettings({ euaPriceEurPerT: p });
          setUpdatedAt(res.settings.updatedAt);
          return repricedMessage(res.repricedRecommendations);
        }}
      />

      <section className="settings-card">
        <h2 className="settings-card__title">Πηγές δεδομένων</h2>
        <dl className="settings-status">
          <div>
            <dt>Καιρός</dt>
            <dd>
              {meta.weatherProvider === "open-meteo"
                ? meta.weatherError
                  ? `Το Open-Meteo δεν απαντά (${meta.weatherError})· χρησιμοποιείται offline προσομοίωση καιρού`
                  : "Open-Meteo Marine API: ύψος κύματος και θαλάσσια ρεύματα, ωριαία πρόγνωση"
                : "Offline προσομοίωση (WEATHER_PROVIDER=mock)"}
            </dd>
          </div>
          <div>
            <dt>Live AIS</dt>
            <dd>
              {!meta.ais.enabled
                ? "Ανενεργό. Προσθέστε AISSTREAM_API_KEY στο .env (ποτέ στο git) και κάντε restart το API."
                : meta.ais.trackedMmsi.length === 0
                  ? "Υπάρχει κλειδί. Συνδέστε το MMSI ενός πλοίου από το πλαίσιό του στη σελίδα Στόλος."
                  : `${meta.ais.connected ? "Συνδεδεμένο" : "Επανασύνδεση"} · ${meta.ais.trackedMmsi.length} πλοία · ${meta.ais.messagesReceived} αναφορές θέσης${meta.ais.lastError ? ` · τελευταίο σφάλμα: ${meta.ais.lastError}` : ""}`}
            </dd>
          </div>
          <div>
            <dt>CII {YEAR}</dt>
            <dd>
              Το απαιτούμενο CII είναι {ciiReductionFactor(YEAR)}% κάτω από τη γραμμή αναφοράς του 2019 (MEPC.400(83): 13,625% το 2027, αυξανόμενο σε 21,5% το 2030).
            </dd>
          </div>
        </dl>
        {updatedAt && <p className="settings-card__meta">Τελευταία αλλαγή τιμών {new Date(updatedAt).toLocaleString("el-GR")}</p>}
      </section>

      <section className="settings-card settings-card--danger">
        <h2 className="settings-card__title">Έλεγχος παρουσίασης</h2>
        <p className="settings-card__help">
          Επαναφέρει το demo στην αρχή: διαγράφει emails, συστάσεις, απαντήσεις και ταξίδια, και τα ξαναφτιάχνει με τα πλοία
          στη θέση εκκίνησης (το MV Aegean Star πριν από το Γιβραλτάρ). Πλοία, λιμάνια, προμηθευτές και τιμές μένουν ως έχουν.
          Κάντε το λίγο πριν την παρουσίαση.
        </p>
        {resetError && <div className="error-state" role="alert">{resetError}</div>}
        {resetMessage && <div className="settings-card__ok" role="status">{resetMessage}</div>}
        <div className="settings-card__actions">
          <button type="button" className="btn btn-danger" onClick={handleResetDemo} disabled={resetting}>
            {resetting ? "Επαναφορά…" : "Επαναφορά demo"}
          </button>
        </div>
      </section>
    </div>
  );
}
