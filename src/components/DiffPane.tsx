import { diffWords, type Change } from "diff";
import { useMemo } from "react";

import { type Turn } from "../lib/ipc";

interface Props {
  left: Turn;
  right: Turn;
  onClose: () => void;
}

function renderSide(
  changes: Change[],
  side: "left" | "right",
): React.ReactNode {
  return changes.map((c, i) => {
    if (side === "left" && c.added) return null;
    if (side === "right" && c.removed) return null;
    if (c.added) return <ins key={i}>{c.value}</ins>;
    if (c.removed) return <del key={i}>{c.value}</del>;
    return <span key={i}>{c.value}</span>;
  });
}

function formatMeta(t: Turn): string {
  const role = t.role;
  const ts = new Date(t.created_at).toLocaleString();
  const eval_count = t.generated_by?.response_meta?.eval_count;
  const model = t.generated_by?.model;
  const bits = [role, ts];
  if (model) bits.push(model);
  if (eval_count != null) bits.push(`${eval_count} tokens`);
  return bits.join(" · ");
}

export function DiffPane({ left, right, onClose }: Props) {
  const changes = useMemo(
    () => diffWords(left.content, right.content),
    [left.content, right.content],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      const words = c.value.trim().split(/\s+/).filter(Boolean).length;
      if (c.added) added += words;
      else if (c.removed) removed += words;
    }
    return { added, removed };
  }, [changes]);

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel diff-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>
            diff — <strong>+{stats.added}</strong>{" "}
            <strong className="removed">−{stats.removed}</strong> words
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="diff-split">
          <div className="diff-side">
            <div className="diff-side-header">{formatMeta(left)}</div>
            <pre className="diff-body">{renderSide(changes, "left")}</pre>
          </div>
          <div className="diff-divider" />
          <div className="diff-side">
            <div className="diff-side-header">{formatMeta(right)}</div>
            <pre className="diff-body">{renderSide(changes, "right")}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
