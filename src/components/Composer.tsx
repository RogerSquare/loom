import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useMemo, useState } from "react";

import { buildContextMessages } from "../lib/ipc";
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
        "&": { backgroundColor: "transparent", fontSize: "0.8rem" },
        ".cm-content": { padding: "0.4rem 0" },
        ".cm-focused": { outline: "none" },
        ".cm-gutters": { display: "none" },
      }),
    ],
    [],
  );

  const computeRequestJson = () => {
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
  };

  const toggleRawJson = () => {
    if (!rawJsonMode) {
      setRawJson(computeRequestJson());
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
        <label className="toggle-label" title="capture per-token logprobs (adds storage)">
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
              theme="dark"
              placeholder="edit the outbound JSON request…"
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
            placeholder="message… (Ctrl+Enter to send)"
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
      <div className="row composer-actions">
        <button
          onClick={send}
          disabled={
            streaming ||
            (rawJsonMode ? !rawJson.trim() : !content.trim())
          }
        >
          {streaming
            ? "streaming…"
            : rawJsonMode
              ? "send raw JSON"
              : "send (Ctrl+Enter)"}
        </button>
        <button
          className={rawJsonMode ? "toggle-active" : ""}
          onClick={toggleRawJson}
          title={
            rawJsonMode
              ? "switch to normal composer"
              : "edit the outbound API request as raw JSON"
          }
        >
          {rawJsonMode ? "← normal" : "{ } JSON"}
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
