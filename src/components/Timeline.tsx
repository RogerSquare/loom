import { useEffect, useMemo, useRef, useState } from "react";

import { buildContextMessages, buildTimeline, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";
import { DiffPane } from "./DiffPane";
import { EditPanel } from "./EditPanel";
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
  const [sweepingFrom, setSweepingFrom] = useState<Turn | null>(null);

  const { timeline, excluded, rootId } = useMemo(() => {
    if (!current)
      return { timeline: [] as Turn[], excluded: new Set<string>(), rootId: "" };
    const chain = buildTimeline(current);
    const { excluded } = buildContextMessages(current);
    return { timeline: chain, excluded, rootId: chain[0]?.id ?? "" };
  }, [current]);

  useEffect(() => {
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
        {timeline.map((t) => (
          <TurnCard
            key={t.id}
            turn={t}
            excluded={excluded.has(t.id)}
            isRoot={t.id === rootId}
            onEdit={setEditing}
            onCompare={(left, right) => setComparing({ left, right })}
            onSweep={setSweepingFrom}
          />
        ))}
        {streamingTurn && <TurnCard turn={streamingTurn} streaming />}
        {sendError && (
          <div className="error">stream error: {sendError.message}</div>
        )}
      </div>
      {editing && <EditPanel turn={editing} onClose={() => setEditing(null)} />}
      {comparing && (
        <DiffPane
          left={comparing.left}
          right={comparing.right}
          onClose={() => setComparing(null)}
        />
      )}
      {sweepingFrom && !sweep && (
        <SweepLauncher
          turn={sweepingFrom}
          onClose={() => setSweepingFrom(null)}
        />
      )}
      {sweep && <SweepModal />}
    </>
  );
}
