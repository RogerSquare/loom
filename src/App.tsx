import { useEffect } from "react";

import { BranchTabs } from "./components/BranchTabs";
import { CommitGraph } from "./components/CommitGraph";
import { Composer } from "./components/Composer";
import { SessionSidebar } from "./components/SessionSidebar";
import { Timeline } from "./components/Timeline";
import { useLoom } from "./lib/store";
import "./App.css";

function App() {
  const refresh = useLoom((s) => s.refresh);
  const current = useLoom((s) => s.current);
  const modelsError = useLoom((s) => s.modelsError);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <SessionSidebar />
      <main className="main">
        {modelsError && (
          <div className="banner error">
            ollama unreachable ({modelsError}) — start <code>ollama serve</code>
          </div>
        )}
        {current ? (
          <>
            <header className="session-header">
              <div>
                <h2>{current.session.title}</h2>
                <span className="session-sub">
                  {Object.keys(current.turns).length} turns ·{" "}
                  {Object.keys(current.branches).length} branches · created{" "}
                  {new Date(current.session.created_at).toLocaleString()}
                </span>
              </div>
            </header>
            <BranchTabs />
            <div className="session-body">
              <Timeline />
              <CommitGraph />
            </div>
            <Composer />
          </>
        ) : (
          <div className="empty-state">
            <h1>Loom</h1>
            <p>pick a session on the left, or <strong>+</strong> to start a new one.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
