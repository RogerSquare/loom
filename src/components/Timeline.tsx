import { useEffect, useMemo, useRef, useState } from "react";

import { buildContextMessages, buildTimeline, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";
import { DiffMatrix } from "./DiffMatrix";
import { DiffPane } from "./DiffPane";
import { EditPanel } from "./EditPanel";
import { JudgeModal } from "./JudgeModal";
import { SweepLauncher } from "./SweepLauncher";
import { SweepModal } from "./SweepModal";
import { TurnCard } from "./TurnCard";

export function Timeline() {
  const current = useLoom((s) => s.current);
  const streaming = useLoom((s) => s.streaming);
  const streamingContent = useLoom((s) => s.streamingContent);
  const sendError = useLoom((s) => s.sendError);
  const sweep = useLoom((s) => s.sweep);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<Turn | null>(null);
  const [comparing, setComparing] = useState<{ left: Turn; right: Turn } | null>(
    null,
  );
  const [matrixTurns, setMatrixTurns] = useState<Turn[] | null>(null);
  const [judging, setJudging] = useState<Turn | null>(null);
  const [sweepingFrom, setSweepingFrom] = useState<Turn | null>(null);

  const { timeline, excluded, rootId } = useMemo(() => {
    if (!current)
      return { timeline: [] as Turn[], excluded: new Set<string>(), rootId: "" };
    const chain = buildTimeline(current);
    const { excluded } = buildContextMessages(current);
    return { timeline: chain, excluded, rootId: chain[0]?.id ?? "" };
  }, [current]);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastScrollRef.current < 100) return; // throttle to ~10fps
    lastScrollRef.current = now;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline.length, streamingContent, streaming]);

  const streamingTurn: Turn | null = streaming
    ? {
        id: "__streaming__",
        parent: null,
        role: "assistant",
        content: streamingContent,
        created_at: new Date().toISOString(),
      }
    : null;

  return (
    <>
      <div className="timeline" ref={scrollRef}>
        {timeline.length <= 1 && !streaming && (
          <div className="timeline-empty">
            <p>send your first message below to start the conversation.</p>
            <p className="muted">edit any turn later to fork a new branch.</p>
          </div>
        )}
        {timeline.map((t) => (
          <TurnCard
            key={t.id}
            turn={t}
            excluded={excluded.has(t.id)}
            isRoot={t.id === rootId}
            onEdit={setEditing}
            onCompare={(left, right) => setComparing({ left, right })}
            onCompareAll={setMatrixTurns}
            onJudge={setJudging}
            onSweep={setSweepingFrom}
          />
        ))}
        {streamingTurn && <TurnCard turn={streamingTurn} streaming />}
        {sendError && (
          <div className="error" role="alert">stream error: {sendError.message}</div>
        )}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {streaming
            ? "assistant is responding…"
            : timeline.length > 1
              ? `${timeline.length} turns in conversation`
              : ""}
        </div>
      </div>
      {editing && <EditPanel turn={editing} onClose={() => setEditing(null)} />}
      {comparing && (
        <DiffPane
          left={comparing.left}
          right={comparing.right}
          onClose={() => setComparing(null)}
        />
      )}
      {matrixTurns && (
        <DiffMatrix turns={matrixTurns} onClose={() => setMatrixTurns(null)} />
      )}
      {sweepingFrom && !sweep && (
        <SweepLauncher
          turn={sweepingFrom}
          onClose={() => setSweepingFrom(null)}
        />
      )}
      {judging && (
        <JudgeModal
          turn={judging}
          contextTurns={timeline}
          onClose={() => setJudging(null)}
        />
      )}
      {sweep && <SweepModal />}
    </>
  );
}
