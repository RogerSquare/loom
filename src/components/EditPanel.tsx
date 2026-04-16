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
  const streaming = useLoom((s) => s.streaming);
  const [content, setContent] = useState(turn.content);
  const [regenerate, setRegenerate] = useState(
    turn.role === "user" || turn.role === "system",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setContent(turn.content);
    setRegenerate(turn.role === "user" || turn.role === "system");
  }, [turn.id]);

  const save = async () => {
    if (!content.trim() || busy || streaming) return;
    setBusy(true);
    try {
      await forkFromEdit(turn.id, content, {
        regenerate,
        options: { temperature: 0.7, top_p: 0.9, num_ctx: 8192 },
      });
      onClose();
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
        <footer>
          <label className="regen-toggle">
            <input
              type="checkbox"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
            />
            regenerate assistant reply after fork
          </label>
          <div className="row">
            <button onClick={onClose} disabled={busy}>
              cancel
            </button>
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
