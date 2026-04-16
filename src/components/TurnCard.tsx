import { type Turn } from "../lib/ipc";

interface Props {
  turn: Turn;
  streaming?: boolean;
  onEdit?: (turn: Turn) => void;
}

const ROLE_LABEL: Record<Turn["role"], string> = {
  system: "system",
  user: "you",
  assistant: "assistant",
  tool: "tool",
};

export function TurnCard({ turn, streaming, onEdit }: Props) {
  const meta = turn.generated_by?.response_meta;
  const prompt = meta?.prompt_eval_count;
  const reply = meta?.eval_count;
  const total = meta?.total_duration_ns;
  const isEdit = turn.annotations?.includes("edit");

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
