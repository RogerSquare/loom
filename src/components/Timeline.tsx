import { useEffect, useMemo, useRef } from "react";

import { buildTimeline } from "../lib/ipc";
import { useLoom } from "../lib/store";
import { TurnCard } from "./TurnCard";

export function Timeline() {
  const current = useLoom((s) => s.current);
  const streaming = useLoom((s) => s.streaming);
  const streamingContent = useLoom((s) => s.streamingContent);
  const sendError = useLoom((s) => s.sendError);
  const timeline = useMemo(
    () => (current ? buildTimeline(current) : []),
    [current],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline.length, streamingContent, streaming]);

  const streamingTurn = streaming
    ? {
        id: "__streaming__",
        parent: null,
        role: "assistant" as const,
        content: streamingContent,
        created_at: new Date().toISOString(),
      }
    : null;

  return (
    <div className="timeline" ref={scrollRef}>
      {timeline.map((t) => (
        <TurnCard key={t.id} turn={t} />
      ))}
      {streamingTurn && <TurnCard turn={streamingTurn} streaming />}
      {sendError && (
        <div className="error">stream error: {sendError.message}</div>
      )}
    </div>
  );
}
