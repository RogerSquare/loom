import { useEffect, useRef, useState } from "react";

import { findSiblings, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Props {
  turn: Turn;
  streaming?: boolean;
  excluded?: boolean;
  isRoot?: boolean;
  onEdit?: (turn: Turn) => void;
  onCompare?: (left: Turn, right: Turn) => void;
}

const ROLE_LABEL: Record<Turn["role"], string> = {
  system: "system",
  user: "you",
  assistant: "assistant",
  tool: "tool",
};

export function TurnCard({
  turn,
  streaming,
  excluded,
  isRoot,
  onEdit,
  onCompare,
}: Props) {
  const current = useLoom((s) => s.current);
  const pinTurn = useLoom((s) => s.pinTurn);
  const [compareOpen, setCompareOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const meta = turn.generated_by?.response_meta;
  const prompt = meta?.prompt_eval_count;
  const reply = meta?.eval_count;
  const total = meta?.total_duration_ns;
  const seed = turn.generated_by?.options?.seed;
  const isEdit = turn.annotations?.includes("edit");
  const pinned = !!turn.pinned;
  const setSeedDraft = useLoom((s) => s.setSeedDraft);
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const copySeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (seed == null) return;
    setSeedDraft(seed.toString());
    void navigator.clipboard.writeText(seed.toString()).catch(() => {});
  };

  const siblings = current ? findSiblings(current, turn.id) : [];

  useEffect(() => {
    if (!compareOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setCompareOpen(false);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [compareOpen]);

  const togglePin = () => {
    pinTurn(turn.id, !pinned);
  };

  return (
    <div
      className={
        `turn turn-${turn.role}` +
        (streaming ? " streaming" : "") +
        (excluded ? " excluded" : "") +
        (pinned ? " pinned" : "")
      }
    >
      <div className="turn-header">
        <span className="role">
          {ROLE_LABEL[turn.role]}
          {isEdit && <span className="edit-badge">edited</span>}
          {excluded && (
            <span
              className="excluded-badge"
              title="Omitted from outbound context. Lower the context_limit or pin this turn to include it."
            >
              excluded
            </span>
          )}
        </span>
        <div className="turn-header-right">
          {!streaming && !isRoot && (
            <button
              className={pinned ? "pin-button pinned" : "pin-button"}
              onClick={togglePin}
              title={pinned ? "unpin (allow rolling out of context)" : "pin (always include in context)"}
            >
              {pinned ? "📌" : "📍"}
            </button>
          )}
          <span className="timestamp">
            {new Date(turn.created_at).toLocaleTimeString()}
          </span>
          {!streaming && onCompare && siblings.length > 0 && (
            <div
              className="compare-menu-wrap"
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="edit-button"
                onClick={() => setCompareOpen((v) => !v)}
                title="compare with sibling turn"
              >
                compare ({siblings.length})
              </button>
              {compareOpen && (
                <div className="compare-menu">
                  {siblings.map((s) => (
                    <button
                      key={s.id}
                      className="compare-menu-item"
                      onClick={() => {
                        onCompare(turn, s);
                        setCompareOpen(false);
                      }}
                    >
                      <span className="compare-item-role">{s.role}</span>
                      <span className="compare-item-preview">
                        {s.content.slice(0, 60) || "(empty)"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {onEdit && !streaming && (
            <button
              className="edit-button"
              onClick={() => onEdit(turn)}
              title="fork from this turn"
            >
              edit
            </button>
          )}
        </div>
      </div>
      {turn.thinking && (
        <details
          className="thinking-panel"
          open={thinkingOpen}
          onToggle={(e) =>
            setThinkingOpen((e.currentTarget as HTMLDetailsElement).open)
          }
        >
          <summary>
            thinking ({turn.thinking.split(/\s+/).filter(Boolean).length} words)
          </summary>
          <pre className="thinking-body">{turn.thinking}</pre>
        </details>
      )}
      <pre className="turn-body">{turn.content || (streaming ? "▍" : "")}</pre>
      {(prompt != null || reply != null || total != null || seed != null) && (
        <div className="turn-footer">
          {prompt != null && <span>prompt: {prompt}</span>}
          {reply != null && <span>reply: {reply}</span>}
          {total != null && <span>{(total / 1_000_000).toFixed(0)} ms</span>}
          {seed != null && (
            <button
              className="seed-pill"
              onClick={copySeed}
              title="click to copy seed + load into composer"
            >
              seed: {seed}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
