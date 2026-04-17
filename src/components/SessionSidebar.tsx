import { useMemo, useState } from "react";

import { ConfirmModal } from "./ConfirmModal";
import { useLoom } from "../lib/store";

export function SessionSidebar() {
  const sessions = useLoom((s) => s.sessions);
  const sessionsLoading = useLoom((s) => s.sessionsLoading);
  const current = useLoom((s) => s.current);
  const openSession = useLoom((s) => s.openSession);
  const closeSession = useLoom((s) => s.closeSession);
  const deleteSession = useLoom((s) => s.deleteSession);
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

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="brand">LOOM</span>
        <div className="row" style={{ gap: "4px" }}>
          <button
            className="icon-button"
            onClick={closeSession}
            title="New session"
            aria-label="new session"
          >
            +
          </button>
          <button
            className="icon-button"
            onClick={() => window.dispatchEvent(new CustomEvent("loom:open-settings"))}
            title="Settings"
            aria-label="open settings"
          >
            &#9881;
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

      <ul className="session-list">
        {sessionsLoading && sessions.length === 0 && (
          <>
            <li className="skeleton skeleton-row" />
            <li className="skeleton skeleton-row" />
            <li className="skeleton skeleton-row" />
          </>
        )}
        {!sessionsLoading && sessions.length === 0 && (
          <li className="empty">no sessions yet</li>
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
                {s.provider && s.provider !== "ollama" ? `${s.provider}/` : ""}{s.model} · {s.turn_count} turns
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
