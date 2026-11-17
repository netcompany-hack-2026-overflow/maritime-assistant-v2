import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type MetaResponse } from "../lib/api.js";
import "./TopBar.css";

const NAV_ITEMS = [
  { to: "/", label: "Fleet", end: true },
  { to: "/voyages", label: "Voyages", end: false },
  { to: "/inbox", label: "Inbox", end: false },
  { to: "/actions", label: "Actions", end: false },
  { to: "/ask", label: "Ask", end: false },
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
      <div className="top-bar__wordmark">MARITIME OPS</div>
      <nav className="top-bar__nav">
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
              <span className="top-bar__badge">{pendingActionCount}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="top-bar__llm">LLM: {meta ? meta.llmProvider : "..."}</div>
    </header>
  );
}
