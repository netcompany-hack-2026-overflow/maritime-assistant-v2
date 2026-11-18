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
    title: "Reads the email",
    body: "A port agent writes “berth delayed 24 h”. Tidewise extracts port, delay and new berth time, and highlights the exact words it used.",
  },
  {
    icon: FileText,
    title: "Reads the charter party",
    body: "Laytime, NOR, demurrage/despatch and the just-in-time arrival clause come out of the CP, so every option shows its contractual consequences.",
  },
  {
    icon: Sigma,
    title: "Compares A, B, C",
    body: "Keep speed, slow down for JIT, or re-route around the weather: ETA, fuel, CO₂, EU ETS cost, demurrage and CII side by side, on the live marine forecast.",
  },
  {
    icon: ShieldCheck,
    title: "You decide",
    body: "Nothing runs on its own. An operator approves a scenario, and the ship visibly changes course or speed on the live globe.",
  },
  {
    icon: Send,
    title: "Tells the charterer",
    body: "On approval, the email to charterers and agent is drafted: new ETA, the reason, and the charter-party terms that apply.",
  },
];

/** A static illustration of the product's core moment: email in, recommendation out. */
function ProductMoment() {
  return (
    <div className="moment" aria-label="Example: a berth-delay email becomes a speed recommendation" role="img">
      <div className="moment__card moment__email">
        <p className="moment__eyebrow">
          <MailOpen size={14} aria-hidden="true" /> ops@rtm-agency · just now
        </p>
        <p className="moment__text">
          The berth for <mark>MV Aegean Star</mark> at <mark>Rotterdam</mark> has been{" "}
          <mark>delayed by 24 hours</mark>.
        </p>
      </div>

      <div className="moment__connector" aria-hidden="true">
        <ArrowDown size={16} />
      </div>

      <div className="moment__card moment__rec">
        <div className="moment__rec-head">
          <p className="moment__eyebrow">Recommendation · awaiting approval</p>
          <p className="moment__speed">
            14.0 kn <ArrowRight size={16} aria-hidden="true" /> <strong>10.7 kn</strong>
          </p>
        </div>
        <dl className="moment__kpis">
          <div>
            <dt>Fuel</dt>
            <dd>57.1 t</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>€34.3k</dd>
          </div>
          <div>
            <dt>CO₂</dt>
            <dd>178 t</dd>
          </div>
        </dl>
        <div className="moment__actions">
          <span className="moment__btn moment__btn--approve">
            <Check size={14} aria-hidden="true" /> Approve
          </span>
          <span className="moment__btn">
            <X size={14} aria-hidden="true" /> Reject
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
        Skip to content
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
          <Link to="/" className="hero__brand" aria-label="Tidewise home">
            <Monogram />
            <span>Tidewise</span>
          </Link>
          <nav aria-label="Main" className="hero__links">
            <a href="#how">How it works</a>
            <a href="#value">Business value</a>
            <Link to="/ask">Ask the fleet</Link>
            <Link to="/fleet" className="hero__nav-cta">
              Open console
            </Link>
          </nav>
        </header>

        <main id="landing-main" className="hero__body">
          <div className="hero__copy">
            <p className="hero__eyebrow">Smart maritime operations assistant</p>
            <h1 className="hero__title">
              Arrive <em>on time,</em>
              <br />
              not early.
            </h1>
            <p className="hero__lede">
              When a berth slips, Tidewise reads the agent’s email, finds the ship and works out
              the exact speed to arrive just in time. Then it waits for your approval.
            </p>
            <div className="hero__ctas">
              <Link to="/fleet" className="hero__cta">
                Open the console <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#how" className="hero__ghost">
                How it works
              </a>
            </div>
          </div>

          <ProductMoment />
        </main>

        <dl className="hero__stats">
          <div>
            <dt>Saved on a single 24 h berth delay</dt>
            <dd>€34.3k</dd>
          </div>
          <div>
            <dt>Evaluation emails extracted exactly</dt>
            <dd>12 / 12</dd>
          </div>
          <div>
            <dt>{savedT && savedT > 0 ? "Saved by approved actions so far" : "Actions taken without a human"}</dt>
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
            From one email to one <em>decision.</em>
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
            Open the console <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section id="value" className="how value-teaser" aria-labelledby="value-title">
        <div className="how__inner">
          <h2 id="value-title" className="how__title">
            Business <em>value.</em>
          </h2>
          <div className="value-teaser__grid">
            <div>
              <p className="value-teaser__q">Who is the customer?</p>
              <p>
                Dry bulk and tanker owner-operators on voyage charters, starting with Greek fleets. Used daily by
                operations, chartering and the technical/ESG team.
              </p>
            </div>
            <div>
              <p className="value-teaser__q">What does it save?</p>
              <p>
                One 24 h berth delay on a Supramax 1,200 nm out: about 43 t of fuel and 135 t of CO₂, roughly €33k in fuel plus EU ETS
                allowances, and the demurrage of a day at anchor. At ten notices a year that is around €330k per ship.
              </p>
            </div>
            <div>
              <p className="value-teaser__q">Why now?</p>
              <p>
                EU ETS covers 100% of shipping emissions from 2026 with EUAs near €90/t, CII tightens every year to 2030,
                VLSFO is above $700/t, and IMO is pushing just-in-time arrival.
              </p>
            </div>
          </div>
          <Link to="/value" className="how__cta">
            Run the numbers for your fleet <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <p className="how__credit">Photo: Austin Neill / Unsplash</p>
        </div>
      </section>
    </div>
  );
}
