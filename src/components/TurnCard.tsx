import { useEffect, useRef, useState } from "react";

import { findSiblings, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Props {
  turn: Turn;
  streaming?: boolean;
  onEdit?: (turn: Turn) => void;
  onCompare?: (left: Turn, right: Turn) => void;
}

const ROLE_LABEL: Record<Turn["role"], string> = {
  system: "system",
  user: "you",
  assistant: "assistant",
  tool: "tool",
};

export function TurnCard({ turn, streaming, onEdit, onCompare }: Props) {
  const current = useLoom((s) => s.current);
  const [compareOpen, setCompareOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const meta = turn.generated_by?.response_meta;
  const prompt = meta?.prompt_eval_count;
  const reply = meta?.eval_count;
  const total = meta?.total_duration_ns;
  const isEdit = turn.annotations?.includes("edit");

  const siblings = current ? findSiblings(current, turn.id) : [];

  useEffect(() => {
    if (!compareOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setCompareOpen(false);
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [compareOpen]);

  return (
    <div className={`turn turn-${turn.role}${streaming ? " streaming" : ""}`}>
      <div className="turn-header">
        <span className="role">
          {ROLE_LABEL[turn.role]}
          {isEdit && <span className="edit-badge">edited</span>}
        </span>
        <div className="turn-header-right">
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
      <pre className="turn-body">{turn.content || (streaming ? "▍" : "")}</pre>
      {(prompt != null || reply != null || total != null) && (
        <div className="turn-footer">
          {prompt != null && <span>prompt: {prompt}</span>}
          {reply != null && <span>reply: {reply}</span>}
          {total != null && <span>{(total / 1_000_000).toFixed(0)} ms</span>}
        </div>
      )}
    </div>
  );
}
