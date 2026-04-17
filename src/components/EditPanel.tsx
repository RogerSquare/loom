import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";

import { type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

const extensions = [
  markdown(),
  EditorView.lineWrapping,
  EditorView.theme({
    "&": { backgroundColor: "transparent", fontSize: "0.9rem" },
    ".cm-content": { padding: "0.6rem 0" },
    ".cm-focused": { outline: "none" },
    ".cm-gutters": { display: "none" },
  }),
];

interface Props {
  turn: Turn;
  onClose: () => void;
}

export function EditPanel({ turn, onClose }: Props) {
  const forkFromEdit = useLoom((s) => s.forkFromEdit);
  const continueFromPrefill = useLoom((s) => s.continueFromPrefill);
  const streaming = useLoom((s) => s.streaming);
  const [content, setContent] = useState(turn.content);
  const [regenerate, setRegenerate] = useState(
    turn.role === "user" || turn.role === "system",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(turn.content);
    setRegenerate(turn.role === "user" || turn.role === "system");
    setError(null);
  }, [turn.id]);

  const canPrefill = turn.role === "assistant";

  const save = async () => {
    if (!content.trim() || busy || streaming) return;
    setBusy(true);
    setError(null);
    try {
      await forkFromEdit(turn.id, content, {
        regenerate,
        options: { temperature: 0.7, top_p: 0.9, num_ctx: 8192 },
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const continueHere = async () => {
    if (!content.trim() || busy || streaming) return;
    setBusy(true);
    setError(null);
    try {
      await continueFromPrefill(turn.id, content);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div className="edit-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>
            edit <strong>{turn.role}</strong> turn — saves as a new branch
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="edit-editor">
          <CodeMirror
            value={content}
            onChange={setContent}
            extensions={extensions}
            theme="dark"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
          />
        </div>
        {error && <div className="edit-panel-error error">{error}</div>}
        <footer>
          <label className="regen-toggle">
            <input
              type="checkbox"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
              disabled={canPrefill}
            />
            {canPrefill
              ? "(assistant turns: use 'continue from here' to extend)"
              : "regenerate assistant reply after fork"}
          </label>
          <div className="row">
            <button onClick={onClose} disabled={busy}>
              cancel
            </button>
            {canPrefill && (
              <button
                onClick={continueHere}
                disabled={busy || !content.trim()}
                title="use this text as prefill and let the model continue (via /api/generate raw=true)"
              >
                {busy ? "continuing…" : "continue from here"}
              </button>
            )}
            <button
              className="primary"
              onClick={save}
              disabled={busy || !content.trim()}
            >
              {busy ? "forking…" : "fork + save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
