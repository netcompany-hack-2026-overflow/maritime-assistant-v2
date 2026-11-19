import { Link, NavLink } from "react-router-dom";
import { Monogram } from "./Monogram.js";
import { useEffect, useState } from "react";
import { api, type MetaResponse } from "../lib/api.js";
import "./TopBar.css";

const NAV_ITEMS = [
  { to: "/fleet", label: "Στόλος", end: true },
  { to: "/voyages", label: "Ταξίδια", end: false },
  { to: "/inbox", label: "Εισερχόμενα", end: false },
  { to: "/actions", label: "Ενέργειες", end: false },
  { to: "/bunkering", label: "Ανεφοδιασμός", end: false },
  { to: "/ask", label: "Ερωτήσεις", end: false },
  { to: "/value", label: "Αξία", end: false },
  { to: "/settings", label: "Ρυθμίσεις", end: false },
];

interface TopBarProps {
  pendingActionCount: number;
}

export function TopBar({ pendingActionCount }: TopBarProps) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMeta()
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="top-bar">
      <Link to="/" className="top-bar__wordmark" aria-label="Αρχική Tidewise">
        <Monogram className="top-bar__monogram" />
        <span className="top-bar__name">Tidewise</span>
      </Link>
      <nav className="top-bar__nav" aria-label="Κύριο μενού">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? "top-bar__link top-bar__link--active" : "top-bar__link"
            }
          >
            {item.label}
            {item.to === "/actions" && pendingActionCount > 0 && (
              <span className="top-bar__badge">
                {pendingActionCount}
                <span className="visually-hidden"> pending</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="top-bar__llm" title="Γλωσσικό μοντέλο σε χρήση">
        LLM: {meta ? meta.llmProvider : "..."}
      </div>
    </header>
  );
}
