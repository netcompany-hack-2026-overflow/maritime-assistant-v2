import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar.js";
import { Fleet } from "./pages/Fleet.js";
import { Voyages } from "./pages/Voyages.js";
import { Inbox } from "./pages/Inbox.js";
import { Actions } from "./pages/Actions.js";
import { Ask } from "./pages/Ask.js";
import { api } from "./lib/api.js";

const PENDING_POLL_MS = 5000;

export function App() {
  const [pendingActionCount, setPendingActionCount] = useState(0);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar pendingActionCount={pendingActionCount} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<Fleet />} />
          <Route path="/voyages" element={<Voyages />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/ask" element={<Ask />} />
        </Routes>
      </div>
    </div>
  );
}
