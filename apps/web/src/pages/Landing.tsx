import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, Check, FileText, MailOpen, Send, ShieldCheck, Sigma, X } from "lucide-react";
import { api } from "../lib/api.js";
import { Monogram } from "../components/Monogram.js";
import heroOcean from "../assets/hero-ocean.jpg";
import heroOceanSm from "../assets/hero-ocean-sm.jpg";
import "./Landing.css";

const STEPS = [
  {
    icon: MailOpen,
    title: "Διαβάζει το email",
    body: "Ο πράκτορας γράφει «berth delayed 24 h». Το Tidewise βγάζει λιμάνι, καθυστέρηση και νέα ώρα πρόσδεσης, και επισημαίνει τις ακριβείς λέξεις που χρησιμοποίησε.",
  },
  {
    icon: FileText,
    title: "Διαβάζει το ναυλοσύμφωνο",
    body: "Laytime, NOR, demurrage/despatch και η ρήτρα άφιξης just-in-time διαβάζονται από το ναυλοσύμφωνο, ώστε κάθε επιλογή να δείχνει τις συμβατικές της συνέπειες.",
  },
  {
    icon: Sigma,
    title: "Συγκρίνει A, B, C",
    body: "Ίδια ταχύτητα, μείωση για άφιξη JIT ή αλλαγή διαδρομής λόγω καιρού: ETA, καύσιμο, CO₂, κόστος EU ETS, demurrage και CII δίπλα-δίπλα, με την τρέχουσα θαλάσσια πρόγνωση.",
  },
  {
    icon: ShieldCheck,
    title: "Αποφασίζετε εσείς",
    body: "Τίποτα δεν γίνεται μόνο του. Ο operator εγκρίνει ένα σενάριο και το πλοίο αλλάζει εμφανώς πορεία ή ταχύτητα στη ζωντανή υδρόγειο.",
  },
  {
    icon: Send,
    title: "Ενημερώνει τον ναυλωτή",
    body: "Με την έγκριση γράφεται το email προς ναυλωτές και πράκτορα: νέο ETA, ο λόγος και οι όροι του ναυλοσυμφώνου που ισχύουν.",
  },
];

/** A static illustration of the product's core moment: email in, recommendation out. */
function ProductMoment() {
  return (
    <div className="moment" aria-label="Παράδειγμα: ένα email καθυστέρησης πρόσδεσης γίνεται σύσταση ταχύτητας" role="img">
      <div className="moment__card moment__email">
        <p className="moment__eyebrow">
          <MailOpen size={14} aria-hidden="true" /> ops@rtm-agency · μόλις τώρα
        </p>
        <p className="moment__text">
          Η θέση του <mark>MV Aegean Star</mark> στο <mark>Ρότερνταμ</mark>{" "}
          <mark>καθυστερεί 24 ώρες</mark>.
        </p>
      </div>

      <div className="moment__connector" aria-hidden="true">
        <ArrowDown size={16} />
      </div>

      <div className="moment__card moment__rec">
        <div className="moment__rec-head">
          <p className="moment__eyebrow">Σύσταση · αναμένει έγκριση</p>
          <p className="moment__speed">
            14.0 kn <ArrowRight size={16} aria-hidden="true" /> <strong>10.7 kn</strong>
          </p>
        </div>
        <dl className="moment__kpis">
          <div>
            <dt>Καύσιμο</dt>
            <dd>57.1 t</dd>
          </div>
          <div>
            <dt>Κόστος</dt>
            <dd>€34.3k</dd>
          </div>
          <div>
            <dt>CO₂</dt>
            <dd>178 t</dd>
          </div>
        </dl>
        <div className="moment__actions">
          <span className="moment__btn moment__btn--approve">
            <Check size={14} aria-hidden="true" /> Έγκριση
          </span>
          <span className="moment__btn">
            <X size={14} aria-hidden="true" /> Απόρριψη
          </span>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const [savedT, setSavedT] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getRecommendations("APPROVED")
      .then((recs) => {
        if (!cancelled) setSavedT(recs.reduce((sum, r) => sum + r.fuelSavedT, 0));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">
        Μετάβαση στο περιεχόμενο
      </a>

      <section
        className="hero"
        style={
          {
            "--hero-img": `url(${heroOcean})`,
            "--hero-img-sm": `url(${heroOceanSm})`,
          } as React.CSSProperties
        }
      >
        <header className="hero__nav">
          <Link to="/" className="hero__brand" aria-label="Αρχική Tidewise">
            <Monogram />
            <span>Tidewise</span>
          </Link>
          <nav aria-label="Κύριο μενού" className="hero__links">
            <a href="#how">Πώς δουλεύει</a>
            <Link to="/ask">Ρωτήστε για τον στόλο</Link>
            <Link to="/fleet" className="hero__nav-cta">
              Άνοιγμα κονσόλας
            </Link>
          </nav>
        </header>

        <main id="landing-main" className="hero__body">
          <div className="hero__copy">
            <p className="hero__eyebrow">Έξυπνος βοηθός ναυτιλιακών επιχειρήσεων</p>
            <h1 className="hero__title">
              Φτάστε <em>στην ώρα σας,</em>
              <br />
              όχι νωρίτερα.
            </h1>
            <p className="hero__lede">
              Όταν η θέση πρόσδεσης καθυστερεί, το Tidewise διαβάζει το email του πράκτορα, βρίσκει το
              πλοίο και υπολογίζει την ακριβή ταχύτητα για άφιξη just in time. Μετά περιμένει την έγκρισή σας.
            </p>
            <div className="hero__ctas">
              <Link to="/fleet" className="hero__cta">
                Άνοιγμα κονσόλας <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#how" className="hero__ghost">
                Πώς δουλεύει
              </a>
            </div>
          </div>

          <ProductMoment />
        </main>

        <dl className="hero__stats">
          <div>
            <dt>Εξοικονόμηση σε μία καθυστέρηση πρόσδεσης 24 h</dt>
            <dd>€34.3k</dd>
          </div>
          <div>
            <dt>Emails αξιολόγησης με ακριβή εξαγωγή</dt>
            <dd>18 / 18</dd>
          </div>
          <div>
            <dt>{savedT && savedT > 0 ? "Εξοικονόμηση από εγκεκριμένες ενέργειες ως τώρα" : "Ενέργειες χωρίς ανθρώπινη έγκριση"}</dt>
            <dd>
              {savedT && savedT > 0 ? (
                <>
                  {savedT.toFixed(1)}
                  <span> t</span>
                </>
              ) : (
                "0"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section id="how" className="how" aria-labelledby="how-title">
        <div className="how__inner">
          <h2 id="how-title" className="how__title">
            Από ένα email σε μία <em>απόφαση.</em>
          </h2>
          <ol className="how__steps">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="how__step">
                <span className="how__num">0{i + 1}</span>
                <Icon size={22} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <Link to="/fleet" className="how__cta">
            Άνοιγμα κονσόλας <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <p className="how__credit">Φωτογραφία: Austin Neill / Unsplash</p>
        </div>
      </section>
    </div>
  );
}
