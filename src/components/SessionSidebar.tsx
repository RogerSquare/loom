import { useState } from "react";

import { useLoom } from "../lib/store";

export function SessionSidebar() {
  const {
    sessions,
    current,
    models,
    openSession,
    createSession,
    deleteSession,
  } = useLoom();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newSystem, setNewSystem] = useState("You are a helpful assistant.");
  const [newLimit, setNewLimit] = useState<string>("");
  const setContextLimit = useLoom((s) => s.setContextLimit);

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
        <button className="icon-button" onClick={beginCreate} title="New session">
          +
        </button>
      </header>

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
            <select
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.details?.parameter_size
                    ? ` · ${m.details.parameter_size}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>System prompt</span>
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
            <button onClick={confirmCreate} disabled={!newModel}>
              create
            </button>
            <button onClick={() => setCreating(false)}>cancel</button>
          </div>
        </div>
      )}

      <ul className="session-list">
        {sessions.length === 0 && !creating && (
          <li className="empty">no sessions yet — click + to start</li>
        )}
        {sessions.map((s) => {
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
              <button
                className="delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${s.title}"?`)) deleteSession(s.id);
                }}
                title="Delete"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
