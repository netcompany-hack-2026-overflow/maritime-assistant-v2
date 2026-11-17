import { useEffect, useState } from "react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { Landing } from "./pages/Landing.js";
import { Fleet } from "./pages/Fleet.js";
import { Voyages } from "./pages/Voyages.js";
import { Inbox } from "./pages/Inbox.js";
import { Actions } from "./pages/Actions.js";
import { Ask } from "./pages/Ask.js";
import { api } from "./lib/api.js";

const PENDING_POLL_MS = 5000;

const PAGE_TITLES: Record<string, string> = {
  "/fleet": "Fleet",
  "/voyages": "Voyages",
  "/inbox": "Inbox",
  "/actions": "Actions",
  "/ask": "Ask",
};

/** Shell for the operational pages: top bar + scrollable main region. */
function ConsoleLayout() {
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const title = PAGE_TITLES[location.pathname];
    document.title = title ? `${title} · Tidewise` : "Tidewise";
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .getRecommendations("PENDING")
        .then((recs) => {
          if (!cancelled) setPendingActionCount(recs.length);
        })
        .catch(() => {
          /* ignore transient errors in the badge poll */
        });
    };
    poll();
    const interval = setInterval(poll, PENDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="console">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar pendingActionCount={pendingActionCount} />
      <main id="main" className="console__main" tabIndex={-1}>
        <h1 className="visually-hidden">{PAGE_TITLES[location.pathname] ?? "Tidewise"}</h1>
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<ConsoleLayout />}>
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/voyages" element={<Voyages />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/actions" element={<Actions />} />
        <Route path="/ask" element={<Ask />} />
      </Route>
    </Routes>
  );
}
