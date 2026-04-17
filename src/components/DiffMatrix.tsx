import { diffWords } from "diff";
import { useMemo } from "react";

import { type Turn } from "../lib/ipc";

interface Props {
  turns: Turn[];
  onClose: () => void;
}

function renderDiffAgainstBase(base: string, target: string): React.ReactNode {
  const changes = diffWords(base, target);
  return changes.map((c, i) => {
    if (c.added) return <ins key={i}>{c.value}</ins>;
    if (c.removed) return null;
    return <span key={i}>{c.value}</span>;
  });
}

export function DiffMatrix({ turns, onClose }: Props) {
  const base = turns[0];

  const stats = useMemo(() => {
    const unique = new Set(turns.map((t) => t.content.trim()));
    return { total: turns.length, unique: unique.size };
  }, [turns]);

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel diff-matrix-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>
            compare all {turns.length} siblings —{" "}
            <strong>{stats.unique}</strong> unique
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>

        <div
          className="diff-matrix-grid"
          style={{
            gridTemplateColumns: `repeat(${turns.length}, 1fr)`,
          }}
        >
          {turns.map((t, i) => (
            <div key={t.id} className="diff-matrix-col">
              <div className="diff-matrix-col-header">
                <span className="diff-matrix-idx">#{i + 1}</span>
                <span className="diff-matrix-meta">
                  {t.role} ·{" "}
                  {new Date(t.created_at).toLocaleTimeString()}
                  {t.generated_by?.response_meta?.eval_count != null &&
                    ` · ${t.generated_by.response_meta.eval_count} tok`}
                </span>
                {i === 0 && <span className="diff-matrix-base">baseline</span>}
              </div>
              <pre className="diff-matrix-body">
                {i === 0
                  ? t.content
                  : renderDiffAgainstBase(base.content, t.content)}
              </pre>
            </div>
          ))}
        </div>

        <footer>
          <span className="muted">
            diffs shown against column #1 (baseline)
          </span>
          <button onClick={onClose}>close</button>
        </footer>
      </div>
    </div>
  );
}
