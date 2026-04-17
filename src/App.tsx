import { useEffect, useState } from "react";

import { BranchTabs } from "./components/BranchTabs";
import { CommitGraph } from "./components/CommitGraph";
import { Composer } from "./components/Composer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ExportModal } from "./components/ExportModal";
import { GarakModal } from "./components/GarakModal";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { Timeline } from "./components/Timeline";
import { WelcomeModal } from "./components/WelcomeModal";
import { useLoom } from "./lib/store";
import "./App.css";

function App() {
  const refresh = useLoom((s) => s.refresh);
  const current = useLoom((s) => s.current);
  const models = useLoom((s) => s.models);
  const modelsError = useLoom((s) => s.modelsError);
  const renameSession = useLoom((s) => s.renameSession);
  const setContextLimit = useLoom((s) => s.setContextLimit);
  const setSessionModel = useLoom((s) => s.setSessionModel);
  const setSessionTags = useLoom((s) => s.setSessionTags);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [garakOpen, setGarakOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [graphVisible, setGraphVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem("loom_first_run_done"),
  );

  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    window.addEventListener("loom:open-settings", handler);
    return () => window.removeEventListener("loom:open-settings", handler);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  const addTag = () => {
    if (!current || !tagDraft.trim()) return;
    const existing = current.session.tags ?? [];
    const tag = tagDraft.trim().toLowerCase();
    if (!existing.includes(tag)) {
      setSessionTags([...existing, tag]);
    }
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    if (!current) return;
    setSessionTags((current.session.tags ?? []).filter((t) => t !== tag));
  };

  // Check if the current model exists in the available models list
  const currentModelExists =
    current && models.some((m) => m.name === current.session.model);

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <button
        className="hamburger"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? "close sidebar" : "open sidebar"}
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>
      {sidebarOpen && (
        <ErrorBoundary name="SessionSidebar">
          <SessionSidebar />
        </ErrorBoundary>
      )}
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
                  {" · "}model:{" "}
                  <select
                    className="model-switcher"
                    value={current.session.model}
                    onChange={(e) => setSessionModel(e.target.value)}
                    title="switch model for this session"
                  >
                    {/* Always include current model even if not in list */}
                    {!currentModelExists && (
                      <option value={current.session.model}>
                        {current.session.model} (not found)
                      </option>
                    )}
                    {models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </span>
                {/* Model not found hint */}
                {!currentModelExists && models.length > 0 && (
                  <div className="model-missing-hint">
                    model not available locally — run{" "}
                    <code
                      className="copy-hint"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          `ollama pull ${current.session.model}`,
                        )
                      }
                      title="click to copy"
                    >
                      ollama pull {current.session.model}
                    </code>
                  </div>
                )}
                {/* Session tags */}
                <div className="session-tag-editor">
                  {(current.session.tags ?? []).map((t) => (
                    <span key={t} className="tag-badge removable">
                      {t}
                      <button onClick={() => removeTag(t)} aria-label={`remove tag ${t}`}>
                        x
                      </button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    placeholder="+ tag"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addTag();
                    }}
                    onBlur={() => {
                      if (tagDraft.trim()) addTag();
                    }}
                  />
                </div>
              </div>
              <div className="row" style={{ gap: "0.4rem" }}>
                <button
                  className={`header-action${graphVisible ? " toggle-active" : ""}`}
                  onClick={() => setGraphVisible((v) => !v)}
                  title={graphVisible ? "hide commit graph" : "show commit graph"}
                  aria-label="toggle commit graph"
                >
                  graph
                </button>
                <button
                  className="header-action"
                  onClick={() => setExportOpen(true)}
                  title="export current branch as a runnable curl script"
                >
                  export
                </button>
                <button
                  className="header-action"
                  onClick={() => setGarakOpen(true)}
                  title="run garak red-team probes against the active model"
                >
                  scan
                </button>
              </div>
            </header>
            <ErrorBoundary name="BranchTabs">
              <BranchTabs />
            </ErrorBoundary>
            <div className="session-body">
              <ErrorBoundary name="Timeline">
                <Timeline />
              </ErrorBoundary>
              {graphVisible && (
                <ErrorBoundary name="CommitGraph">
                  <CommitGraph />
                </ErrorBoundary>
              )}
            </div>
            <ErrorBoundary name="Composer">
              <Composer />
            </ErrorBoundary>
          </>
        ) : (
          <div className="empty-state">
            <h1>Loom</h1>
            <p>pick a session on the left, or <strong>+</strong> to start a new one.</p>
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
      {showWelcome && (
        <WelcomeModal onClose={() => setShowWelcome(false)} />
      )}
      {shortcutsOpen && (
        <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />
      )}
      {garakOpen && <GarakModal onClose={() => setGarakOpen(false)} />}
      {exportOpen && current && (
        <ExportModal file={current} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

export default App;
