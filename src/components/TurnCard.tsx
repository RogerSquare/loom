import { memo, useEffect, useRef, useState } from "react";

import { findSiblings, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";
import { LogprobsBody } from "./LogprobsBody";
import { RerunPopover } from "./RerunPopover";

interface Props {
  turn: Turn;
  streaming?: boolean;
  excluded?: boolean;
  isRoot?: boolean;
  onEdit?: (turn: Turn) => void;
  onCompare?: (left: Turn, right: Turn) => void;
  onCompareAll?: (turns: Turn[]) => void;
  onSweep?: (turn: Turn) => void;
  onJudge?: (turn: Turn) => void;
}

const ROLE_LABEL: Record<Turn["role"], string> = {
  system: "system",
  user: "you",
  assistant: "assistant",
  tool: "tool",
};

export const TurnCard = memo(function TurnCard({
  turn,
  streaming,
  excluded,
  isRoot,
  onEdit,
  onCompare,
  onCompareAll,
  onSweep,
  onJudge,
}: Props) {
  const current = useLoom((s) => s.current);
  const pinTurn = useLoom((s) => s.pinTurn);
  const setSeedDraft = useLoom((s) => s.setSeedDraft);
  const annotateTurn = useLoom((s) => s.annotateTurn);
  const [compareOpen, setCompareOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const siblings = current ? findSiblings(current, turn.id) : [];
  const allVersions = siblings.length > 0 ? [turn, ...siblings] : [turn];
  const hasSwipe = allVersions.length > 1;
  const swipeIdx =
    ((swipeOffset % allVersions.length) + allVersions.length) %
    allVersions.length;
  const displayed = allVersions[swipeIdx];

  const meta = displayed.generated_by?.response_meta;
  const prompt = meta?.prompt_eval_count;
  const reply = meta?.eval_count;
  const total = meta?.total_duration_ns;
  const seed = displayed.generated_by?.options?.seed;
  const isEdit = displayed.annotations?.includes("edit");
  const pinned = !!displayed.pinned;
  const annotations = displayed.annotations?.filter((a) => a !== "edit") ?? [];

  const addNote = () => {
    if (!noteInput.trim()) return;
    annotateTurn(turn.id, [...annotations, noteInput.trim()]);
    setNoteInput("");
    setAddingNote(false);
  };

  const removeNote = (idx: number) => {
    annotateTurn(turn.id, annotations.filter((_, i) => i !== idx));
  };

  const copySeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (seed == null) return;
    setSeedDraft(seed.toString());
    void navigator.clipboard.writeText(seed.toString()).catch(() => {});
  };

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

  const isAssistant = turn.role === "assistant";
  const hasParent = !!turn.parent;
  const hasSiblings = siblings.length > 0;

  return (
    <div
      className={
        `turn turn-${displayed.role}` +
        (streaming ? " streaming" : "") +
        (excluded ? " excluded" : "") +
        (pinned ? " pinned" : "")
      }
    >
      {/* ── Pin gutter ── */}
      {!streaming && !isRoot && (
        <button
          className={`turn-pin-gutter${pinned ? " pinned" : ""}`}
          onClick={togglePin}
          title={pinned ? "unpin (allow rolling out of context)" : "pin (always include in context)"}
          aria-label={pinned ? "unpin turn" : "pin turn"}
        />
      )}

      {/* ── Header: role + timestamp ── */}
      <div className="turn-header">
        <span className="role">
          {ROLE_LABEL[displayed.role]}
          {hasSwipe && (
            <span className="swipe-controls">
              <button
                className="swipe-arrow"
                aria-label="previous sibling"
                onClick={(e) => {
                  e.stopPropagation();
                  setSwipeOffset((o) => o - 1);
                }}
              >
                &#8249;
              </button>
              <span className="swipe-counter">
                {swipeIdx + 1}/{allVersions.length}
              </span>
              <button
                className="swipe-arrow"
                aria-label="next sibling"
                onClick={(e) => {
                  e.stopPropagation();
                  setSwipeOffset((o) => o + 1);
                }}
              >
                &#8250;
              </button>
            </span>
          )}
          {isEdit && <span className="edit-badge">edited</span>}
          {excluded && (
            <span
              className="excluded-badge"
              title="Omitted from outbound context"
            >
              excluded
            </span>
          )}
        </span>
        <span className="timestamp">
          {new Date(turn.created_at).toLocaleTimeString()}
        </span>
      </div>

      {/* ── Thinking panel ── */}
      {displayed.thinking && (
        <details
          className="thinking-panel"
          open={thinkingOpen}
          onToggle={(e) =>
            setThinkingOpen((e.currentTarget as HTMLDetailsElement).open)
          }
        >
          <summary>
            thinking ({displayed.thinking.split(/\s+/).filter(Boolean).length} words)
          </summary>
          <pre className="thinking-body">{displayed.thinking}</pre>
        </details>
      )}

      {/* ── Body ── */}
      {displayed.logprobs && displayed.logprobs.length > 0 ? (
        <LogprobsBody logprobs={displayed.logprobs} />
      ) : (
        <pre className="turn-body">
          {displayed.content || (streaming ? "\u258D" : "")}
        </pre>
      )}

      {/* ── Annotations ── */}
      {annotations.length > 0 && (
        <div className="annotations">
          {annotations.map((a, i) => (
            <span key={i} className="annotation-tag">
              {a}
              <button className="annotation-rm" onClick={() => removeNote(i)}>
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {addingNote && (
        <div className="annotation-input-row">
          <input
            className="annotation-input"
            autoFocus
            placeholder="type a note..."
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addNote();
              else if (e.key === "Escape") setAddingNote(false);
            }}
          />
          <button onClick={addNote} disabled={!noteInput.trim()}>
            add
          </button>
        </div>
      )}

      {/* ── Footer: response meta ── */}
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

      {/* ── Hover action toolbar ── */}
      {!streaming && (
        <div className="turn-toolbar">
          {/* Primary: edit */}
          {onEdit && (
            <button
              className="toolbar-btn"
              onClick={() => onEdit(turn)}
              title="fork from this turn"
            >
              edit
            </button>
          )}

          {/* Divider if we have more actions */}
          {(isAssistant || hasSiblings) && onEdit && (
            <span className="toolbar-divider" />
          )}

          {/* Compare group */}
          {hasSiblings && onCompare && (
            <div
              className="compare-menu-wrap"
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="toolbar-btn"
                onClick={() => setCompareOpen((v) => !v)}
                title="compare with sibling"
              >
                compare
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

          {onCompareAll && siblings.length >= 2 && (
            <button
              className="toolbar-btn"
              onClick={() => onCompareAll([turn, ...siblings])}
              title="compare all siblings"
            >
              all ({siblings.length + 1})
            </button>
          )}

          {/* Evaluate group (assistant-only) */}
          {isAssistant && hasParent && (
            <>
              {hasSiblings && <span className="toolbar-divider" />}
              <div className="compare-menu-wrap">
                <button
                  className="toolbar-btn"
                  onClick={() => setRerunOpen((v) => !v)}
                  title="rerun with different params"
                >
                  rerun
                </button>
                {rerunOpen && (
                  <RerunPopover
                    turn={turn}
                    onClose={() => setRerunOpen(false)}
                  />
                )}
              </div>
            </>
          )}

          {onSweep && isAssistant && (
            <button
              className="toolbar-btn"
              onClick={() => onSweep(turn)}
              title="variance sweep"
            >
              sweep
            </button>
          )}

          {onJudge && isAssistant && (
            <button
              className="toolbar-btn"
              onClick={() => onJudge(turn)}
              title="LLM-as-judge"
            >
              judge
            </button>
          )}

          {/* Meta group */}
          <span className="toolbar-divider" />
          <button
            className="toolbar-btn"
            onClick={() => setAddingNote((v) => !v)}
            title="add note"
          >
            note
          </button>
        </div>
      )}
    </div>
  );
}, (prev, next) =>
  prev.turn === next.turn &&
  prev.streaming === next.streaming &&
  prev.excluded === next.excluded &&
  prev.isRoot === next.isRoot
);
