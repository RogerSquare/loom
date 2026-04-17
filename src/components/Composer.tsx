import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useMemo, useState } from "react";

import { buildContextMessages } from "../lib/ipc";
import { useLoom } from "../lib/store";

const cmTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "15px" },
  ".cm-content": { padding: "8px 0", caretColor: "var(--accent)" },
  ".cm-focused": { outline: "none" },
  ".cm-gutters": { display: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground": { backgroundColor: "rgba(100,150,255,0.2) !important" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-line": { color: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(100,150,255,0.25) !important" },
  ".cm-placeholder": { color: "var(--dim)" },
});

const extensions = [markdown(), EditorView.lineWrapping, cmTheme];

export function Composer() {
  const streaming = useLoom((s) => s.streaming);
  const current = useLoom((s) => s.current);
  const sendMessage = useLoom((s) => s.sendMessage);
  const seedDraft = useLoom((s) => s.seedDraft);
  const setSeedDraft = useLoom((s) => s.setSeedDraft);
  const sendError = useLoom((s) => s.sendError);
  const logprobsEnabled = useLoom((s) => s.logprobsEnabled);
  const setLogprobsEnabled = useLoom((s) => s.setLogprobsEnabled);
  const outputFormat = useLoom((s) => s.outputFormat);
  const setOutputFormat = useLoom((s) => s.setOutputFormat);
  const outputSchema = useLoom((s) => s.outputSchema);
  const setOutputSchema = useLoom((s) => s.setOutputSchema);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const rawJsonMode = useLoom((s) => s.rawJsonMode);
  const setRawJsonMode = useLoom((s) => s.setRawJsonMode);
  const sendRawJson = useLoom((s) => s.sendRawJson);
  const [rawJson, setRawJson] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [content, setContent] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [numCtx, setNumCtx] = useState(8192);

  if (!current) return null;

  const seed = seedDraft;
  const setSeed = setSeedDraft;

  const jsonExtensions = useMemo(
    () => [
      jsonLang(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { backgroundColor: "transparent", fontSize: "13px" },
        ".cm-content": { padding: "4px 0", caretColor: "var(--accent)" },
        ".cm-focused": { outline: "none" },
        ".cm-gutters": { backgroundColor: "transparent", color: "var(--dim)", borderRight: "none" },
        ".cm-cursor": { borderLeftColor: "var(--accent)" },
        ".cm-selectionBackground": { backgroundColor: "rgba(100,150,255,0.2) !important" },
        ".cm-activeLine": { backgroundColor: "rgba(100,150,255,0.06)" },
        ".cm-line": { color: "var(--fg)" },
        ".cm-placeholder": { color: "var(--dim)" },
      }),
    ],
    [],
  );

  const computeRequestJson = useMemo(() => {
    const { included } = buildContextMessages(current);
    const messages = included.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    const req: Record<string, unknown> = {
      model: current.session.model,
      messages,
      stream: true,
      options: {
        temperature,
        top_p: topP,
        num_ctx: numCtx,
        ...(seed ? { seed: Number(seed) } : {}),
      },
    };
    if (outputFormat === "json") req.format = "json";
    else if (outputFormat === "schema" && outputSchema.trim()) {
      try {
        req.format = JSON.parse(outputSchema);
      } catch {
        req.format = "json";
      }
    }
    if (logprobsEnabled) {
      req.logprobs = true;
      req.top_logprobs = 5;
    }
    return JSON.stringify(req, null, 2);
  }, [current, temperature, topP, numCtx, seed, outputFormat, outputSchema, logprobsEnabled]);

  const toggleRawJson = () => {
    if (!rawJsonMode) {
      setRawJson(computeRequestJson);
    }
    setRawJsonMode(!rawJsonMode);
  };

  const send = async () => {
    if (rawJsonMode) {
      if (!rawJson.trim() || streaming) return;
      await sendRawJson(rawJson);
      return;
    }
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
      {/* ── Editor area ── */}
      <div className="composer-editor" onKeyDown={onKeyDown}>
        {rawJsonMode ? (
          <>
            <CodeMirror
              value={rawJson}
              onChange={(v) => {
                setRawJson(v);
                setRawJsonError(null);
              }}
              onBlur={() => {
                if (!rawJson.trim()) return;
                try {
                  JSON.parse(rawJson);
                  setRawJsonError(null);
                } catch (e) {
                  setRawJsonError(String(e));
                }
              }}
              extensions={jsonExtensions}
              theme="none"
              placeholder="edit the outbound JSON request..."
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: false,
              }}
            />
            {rawJsonError && (
              <div className="composer-error">{rawJsonError}</div>
            )}
          </>
        ) : (
          <CodeMirror
            value={content}
            onChange={setContent}
            extensions={extensions}
            theme="dark"
            placeholder="message... (Ctrl+Enter to send)"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
          />
        )}
      </div>

      {sendError && (
        <div className="composer-error">error: {sendError.message}</div>
      )}

      {/* ── Action bar: context left, controls right ── */}
      <div className="composer-bar">
        <div className="composer-context">
          <span className="muted">
            {current.session.model}
            {" / "}
            {current.branches[current.head_branch]?.name ?? "main"}
          </span>
        </div>

        <div className="composer-controls">
          <button
            className={`composer-icon-btn${optionsOpen ? " active" : ""}`}
            onClick={() => setOptionsOpen((v) => !v)}
            title="sampling options"
            aria-label="toggle sampling options"
          >
            options
          </button>
          <button
            className={`composer-icon-btn${rawJsonMode ? " active" : ""}`}
            onClick={toggleRawJson}
            title={rawJsonMode ? "switch to normal" : "edit raw JSON request"}
            aria-label="toggle raw JSON mode"
          >
            {"{ }"}
          </button>
          <button
            className="composer-send"
            onClick={send}
            disabled={
              streaming ||
              (rawJsonMode ? !rawJson.trim() : !content.trim())
            }
          >
            {streaming ? "streaming..." : "send"}
          </button>
        </div>
      </div>

      {/* ── Collapsible options panel ── */}
      {optionsOpen && (
        <div className="composer-options-panel">
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
            <label className="toggle-label" title="capture per-token logprobs">
              <input
                type="checkbox"
                checked={logprobsEnabled}
                onChange={(e) => setLogprobsEnabled(e.target.checked)}
              />
              <span>logprobs</span>
            </label>
            <label>
              <span>format</span>
              <select
                value={outputFormat}
                onChange={(e) =>
                  setOutputFormat(e.target.value as "none" | "json" | "schema")
                }
              >
                <option value="none">none</option>
                <option value="json">JSON</option>
                <option value="schema">schema</option>
              </select>
            </label>
          </div>
          {outputFormat === "schema" && (
            <>
              <textarea
                className={`schema-editor${schemaError ? " schema-invalid" : ""}`}
                value={outputSchema}
                onChange={(e) => {
                  setOutputSchema(e.target.value);
                  setSchemaError(null);
                }}
                onBlur={() => {
                  if (!outputSchema.trim()) return;
                  try {
                    JSON.parse(outputSchema);
                    setSchemaError(null);
                  } catch (e) {
                    setSchemaError(String(e));
                  }
                }}
                placeholder='{"type": "object", "properties": { ... }}'
                rows={3}
              />
              {schemaError && (
                <div className="composer-error">{schemaError}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
