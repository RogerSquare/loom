import { useEffect, useState } from "react";

import { BranchTabs } from "./components/BranchTabs";
import { CommitGraph } from "./components/CommitGraph";
import { Composer } from "./components/Composer";
import { GarakModal } from "./components/GarakModal";
import { SessionSidebar } from "./components/SessionSidebar";
import { Timeline } from "./components/Timeline";
import { useLoom } from "./lib/store";
import "./App.css";

function App() {
  const refresh = useLoom((s) => s.refresh);
  const current = useLoom((s) => s.current);
  const modelsError = useLoom((s) => s.modelsError);
  const renameSession = useLoom((s) => s.renameSession);
  const setContextLimit = useLoom((s) => s.setContextLimit);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [garakOpen, setGarakOpen] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commitTitle = () => {
    if (titleDraft != null && titleDraft.trim().length > 0) {
      renameSession(titleDraft.trim());
    }
    setTitleDraft(null);
  };

  const commitLimit = () => {
    if (limitDraft == null) return;
    const trimmed = limitDraft.trim();
    if (trimmed === "") {
      setContextLimit(null);
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0) {
        setContextLimit(Math.floor(n));
      }
    }
    setLimitDraft(null);
  };

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
                {titleDraft == null ? (
                  <h2
                    onDoubleClick={() => setTitleDraft(current.session.title)}
                    title="double-click to rename"
                  >
                    {current.session.title}
                  </h2>
                ) : (
                  <input
                    className="title-edit"
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitTitle();
                      else if (e.key === "Escape") setTitleDraft(null);
                    }}
                  />
                )}
                <span className="session-sub">
                  {Object.keys(current.turns).length} turns ·{" "}
                  {Object.keys(current.branches).length} branches · ctx:{" "}
                  {limitDraft == null ? (
                    <button
                      className="inline-edit"
                      onClick={() =>
                        setLimitDraft(
                          current.session.context_limit?.toString() ?? "",
                        )
                      }
                      title="click to change context limit"
                    >
                      {current.session.context_limit ?? "unlimited"}
                    </button>
                  ) : (
                    <input
                      className="inline-edit-input"
                      autoFocus
                      type="number"
                      min={1}
                      placeholder="unlimited"
                      value={limitDraft}
                      onChange={(e) => setLimitDraft(e.target.value)}
                      onBlur={commitLimit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitLimit();
                        else if (e.key === "Escape") setLimitDraft(null);
                      }}
                    />
                  )}
                  {" · "}created{" "}
                  {new Date(current.session.created_at).toLocaleString()}
                </span>
              </div>
              <button
                className="header-action"
                onClick={() => setGarakOpen(true)}
                title="run garak red-team probes against the active model"
              >
                🛡 scan
              </button>
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
      {garakOpen && <GarakModal onClose={() => setGarakOpen(false)} />}
    </div>
  );
}

export default App;
