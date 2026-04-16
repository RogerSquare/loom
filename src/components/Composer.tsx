import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useState } from "react";

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

export function Composer() {
  const streaming = useLoom((s) => s.streaming);
  const current = useLoom((s) => s.current);
  const sendMessage = useLoom((s) => s.sendMessage);

  const [content, setContent] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [numCtx, setNumCtx] = useState(8192);
  const [seed, setSeed] = useState<string>("");

  if (!current) return null;

  const send = async () => {
    if (!content.trim() || streaming) return;
    const text = content;
    setContent("");
    await sendMessage(text, {
      temperature,
      top_p: topP,
      num_ctx: numCtx,
      ...(seed ? { seed: Number(seed) } : {}),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <div className="composer-options">
        <label>
          <span>temp</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>
        <label>
          <span>top_p</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={topP}
            onChange={(e) => setTopP(Number(e.target.value))}
          />
        </label>
        <label>
          <span>ctx</span>
          <input
            type="number"
            min={512}
            max={131072}
            step={512}
            value={numCtx}
            onChange={(e) => setNumCtx(Number(e.target.value))}
          />
        </label>
        <label>
          <span>seed</span>
          <input
            type="text"
            placeholder="(random)"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
      </div>

      <div className="composer-editor" onKeyDown={onKeyDown}>
        <CodeMirror
          value={content}
          onChange={setContent}
          extensions={extensions}
          theme="dark"
          placeholder="message… (Ctrl+Enter to send)"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </div>

      <div className="row composer-actions">
        <button onClick={send} disabled={streaming || !content.trim()}>
          {streaming ? "streaming…" : "send (Ctrl+Enter)"}
        </button>
        <span className="muted">
          model: <strong>{current.session.model}</strong> · branch:{" "}
          <strong>
            {current.branches[current.head_branch]?.name ?? current.head_branch}
          </strong>
        </span>
      </div>
    </div>
  );
}
