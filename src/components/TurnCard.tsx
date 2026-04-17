import { useEffect, useRef, useState } from "react";

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
  onCompareAll,
  onSweep,
}: Props) {
  const current = useLoom((s) => s.current);
  const pinTurn = useLoom((s) => s.pinTurn);
  const [compareOpen, setCompareOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const meta = displayed.generated_by?.response_meta;
  const prompt = meta?.prompt_eval_count;
  const reply = meta?.eval_count;
  const total = meta?.total_duration_ns;
  const seed = displayed.generated_by?.options?.seed;
  const isEdit = displayed.annotations?.includes("edit");
  const pinned = !!displayed.pinned;
  const setSeedDraft = useLoom((s) => s.setSeedDraft);
  const annotateTurn = useLoom((s) => s.annotateTurn);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);

  const allVersions = siblings.length > 0 ? [turn, ...siblings] : [turn];
  const hasSwipe = allVersions.length > 1;
  const swipeIdx =
    ((swipeOffset % allVersions.length) + allVersions.length) %
    allVersions.length;
  const displayed = allVersions[swipeIdx];

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
        `turn turn-${displayed.role}` +
        (streaming ? " streaming" : "") +
        (excluded ? " excluded" : "") +
        (pinned ? " pinned" : "")
      }
    >
      <div className="turn-header">
        <span className="role">
          {ROLE_LABEL[displayed.role]}
          {hasSwipe && (
            <span className="swipe-controls">
              <button
                className="swipe-arrow"
                onClick={(e) => {
                  e.stopPropagation();
                  setSwipeOffset((o) => o - 1);
                }}
              >
                ‹
              </button>
              <span className="swipe-counter">
                {swipeIdx + 1}/{allVersions.length}
              </span>
              <button
                className="swipe-arrow"
                onClick={(e) => {
                  e.stopPropagation();
                  setSwipeOffset((o) => o + 1);
                }}
              >
                ›
              </button>
            </span>
          )}
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
          {!streaming && (
            <button
              className="edit-button note-button"
              onClick={() => setAddingNote((v) => !v)}
              title="add a note to this turn"
            >
              note
            </button>
          )}
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
          {!streaming && onCompareAll && siblings.length >= 2 && (
            <button
              className="edit-button"
              onClick={() => onCompareAll([turn, ...siblings])}
              title="compare all siblings side-by-side"
            >
              all ({siblings.length + 1})
            </button>
          )}
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
          {!streaming && turn.role === "assistant" && turn.parent && (
            <div className="compare-menu-wrap">
              <button
                className="edit-button"
                onClick={() => setRerunOpen((v) => !v)}
                title="rerun with different sampling parameters"
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
          )}
          {onSweep && !streaming && turn.role === "assistant" && (
            <button
              className="edit-button"
              onClick={() => onSweep(turn)}
              title="run a variance sweep from this turn's prompt"
            >
              sweep
            </button>
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
      {displayed.logprobs && displayed.logprobs.length > 0 ? (
        <LogprobsBody logprobs={displayed.logprobs} />
      ) : (
        <pre className="turn-body">
          {displayed.content || (streaming ? "▍" : "")}
        </pre>
      )}
      {annotations.length > 0 && (
        <div className="annotations">
          {annotations.map((a, i) => (
            <span key={i} className="annotation-tag">
              {a}
              <button className="annotation-rm" onClick={() => removeNote(i)}>
                ×
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
            placeholder="type a note…"
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
