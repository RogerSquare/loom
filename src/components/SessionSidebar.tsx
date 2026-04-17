import { useEffect, useMemo, useState } from "react";

import { ConfirmModal } from "./ConfirmModal";
import { promptList, type PromptEntry } from "../lib/ipc";
import { useLoom } from "../lib/store";

export function SessionSidebar() {
  const sessions = useLoom((s) => s.sessions);
  const sessionsLoading = useLoom((s) => s.sessionsLoading);
  const current = useLoom((s) => s.current);
  const models = useLoom((s) => s.models);
  const modelsLoading = useLoom((s) => s.modelsLoading);
  const openSession = useLoom((s) => s.openSession);
  const createSession = useLoom((s) => s.createSession);
  const deleteSession = useLoom((s) => s.deleteSession);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newSystem, setNewSystem] = useState("You are a helpful assistant.");
  const [newLimit, setNewLimit] = useState<string>("");
  const setContextLimit = useLoom((s) => s.setContextLimit);
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // Search & tag filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Collect all unique tags across sessions
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const s of sessions) {
      for (const t of s.tags ?? []) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }, [sessions]);

  // Filter sessions by search query and active tag
  const filtered = useMemo(() => {
    let result = sessions;
    if (activeTag) {
      result = result.filter((s) => (s.tags ?? []).includes(activeTag));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.model.toLowerCase().includes(q) ||
          (s.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [sessions, searchQuery, activeTag]);

  useEffect(() => {
    promptList().then(setPrompts).catch(() => {});
  }, [creating]);

  const beginCreate = () => {
    setNewTitle("untitled");
    setNewModel(models[0]?.name ?? "");
    setNewLimit("");
    setCreating(true);
  };

  const confirmCreate = async () => {
    if (!newModel) return;
    await createSession(newTitle || "untitled", newModel, newSystem);
    const parsed = newLimit.trim() === "" ? null : Number(newLimit);
    if (parsed != null && Number.isFinite(parsed) && parsed > 0) {
      await setContextLimit(Math.floor(parsed));
    }
    setCreating(false);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="brand">LOOM</span>
        <div className="row" style={{ gap: "4px" }}>
          <button className="icon-button" onClick={beginCreate} title="New session" aria-label="create new session">
            +
          </button>
          <button
            className="icon-button"
            onClick={() => window.dispatchEvent(new CustomEvent("loom:open-settings"))}
            title="Settings"
            aria-label="open settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Search box */}
      <div className="sidebar-search">
        <input
          type="text"
          placeholder="search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="search sessions"
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => setSearchQuery("")}
            aria-label="clear search"
          >
            x
          </button>
        )}
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="tag-filter-bar">
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`tag-chip${activeTag === tag ? " active" : ""}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              title={activeTag === tag ? "clear filter" : `filter by "${tag}"`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {creating && (
        <div className="create-panel">
          <label className="field">
            <span>Title</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Model</span>
            {modelsLoading ? (
              <span className="loading-pulse muted">loading models...</span>
            ) : models.length === 0 ? (
              <span className="empty-hint">
                no models found — run <code>ollama pull llama3.1:8b</code>
              </span>
            ) : (
              <select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                    {m.details?.parameter_size
                      ? ` - ${m.details.parameter_size}`
                      : ""}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>System prompt</span>
            {prompts.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const p = prompts.find((p) => p.name === e.target.value);
                  if (p) setNewSystem(p.content);
                }}
              >
                <option value="">-- load from library --</option>
                {prompts.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <textarea
              value={newSystem}
              onChange={(e) => setNewSystem(e.target.value)}
              rows={3}
            />
          </label>
          <label className="field">
            <span>Context limit (turns, blank = unlimited)</span>
            <input
              type="number"
              min={1}
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              placeholder="e.g. 10"
            />
          </label>
          <div className="row">
            <button onClick={confirmCreate} disabled={!newModel || modelsLoading}>
              create
            </button>
            <button onClick={() => setCreating(false)}>cancel</button>
          </div>
        </div>
      )}

      <ul className="session-list">
        {sessionsLoading && sessions.length === 0 && (
          <li className="empty loading-pulse">loading sessions...</li>
        )}
        {!sessionsLoading && sessions.length === 0 && !creating && (
          <li className="empty">no sessions yet -- click + to start</li>
        )}
        {!sessionsLoading && sessions.length > 0 && filtered.length === 0 && (
          <li className="empty muted">no sessions match filter</li>
        )}
        {filtered.map((s) => {
          const isActive = current?.session.id === s.id;
          return (
            <li
              key={s.id}
              className={isActive ? "session-row active" : "session-row"}
              onClick={() => openSession(s.id)}
            >
              <div className="session-title">{s.title}</div>
              <div className="session-meta">
                {s.model} · {s.turn_count} turns
                {s.branch_count > 1 ? ` · ${s.branch_count} branches` : ""}
              </div>
              {(s.tags ?? []).length > 0 && (
                <div className="session-tags">
                  {(s.tags ?? []).map((t) => (
                    <span key={t} className="tag-badge">{t}</span>
                  ))}
                </div>
              )}
              <button
                className="delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ id: s.id, title: s.title });
                }}
                title="Delete"
              >
                x
              </button>
            </li>
          );
        })}
      </ul>
      {deleteTarget && (
        <ConfirmModal
          title="delete session"
          message={`Permanently delete "${deleteTarget.title}"? This cannot be undone.`}
          confirmLabel="delete"
          danger
          onConfirm={() => {
            deleteSession(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  );
}
