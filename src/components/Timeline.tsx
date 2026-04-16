import { useEffect, useMemo, useRef, useState } from "react";

import { buildTimeline, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";
import { EditPanel } from "./EditPanel";
import { TurnCard } from "./TurnCard";

export function Timeline() {
  const current = useLoom((s) => s.current);
  const streaming = useLoom((s) => s.streaming);
  const streamingContent = useLoom((s) => s.streamingContent);
  const sendError = useLoom((s) => s.sendError);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<Turn | null>(null);

  const timeline = useMemo(
    () => (current ? buildTimeline(current) : []),
    [current],
  );

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
          <TurnCard key={t.id} turn={t} onEdit={setEditing} />
        ))}
        {streamingTurn && <TurnCard turn={streamingTurn} streaming />}
        {sendError && (
          <div className="error">stream error: {sendError.message}</div>
        )}
      </div>
      {editing && (
        <EditPanel turn={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
