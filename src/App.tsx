import { useEffect, useRef, useState } from "react";
import {
  listModels,
  ollamaChat,
  type ModelInfo,
  type StreamEvent,
} from "./lib/ipc";
import "./App.css";

interface DoneMeta {
  prompt_eval_count: number | null;
  eval_count: number | null;
  total_duration_ns: number | null;
}

function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [streaming, setStreaming] = useState<boolean>(false);
  const [meta, setMeta] = useState<DoneMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const responseRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        if (m.length > 0) setSelectedModel(m[0].name);
      })
      .catch((e) => setModelsError(String(e)));
  }, []);

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  const send = async () => {
    if (!selectedModel || !prompt.trim() || streaming) return;
    setStreaming(true);
    setResponse("");
    setMeta(null);
    setError(null);
    try {
      await ollamaChat(
        {
          model: selectedModel,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        },
        (ev: StreamEvent) => {
          if (ev.kind === "delta") {
            setResponse((r) => r + ev.content);
          } else if (ev.kind === "done") {
            setMeta({
              prompt_eval_count: ev.prompt_eval_count,
              eval_count: ev.eval_count,
              total_duration_ns: ev.total_duration_ns,
            });
            setStreaming(false);
          } else if (ev.kind === "error") {
            setError(ev.message);
            setStreaming(false);
          }
        },
      );
    } catch (e) {
      setError(String(e));
      setStreaming(false);
    }
  };

  const ms = (ns: number | null) =>
    ns == null ? "—" : `${(ns / 1_000_000).toFixed(0)} ms`;

  return (
    <main className="container">
      <header>
        <h1>Loom</h1>
        <p className="tagline">phase 1 · ollama debug page</p>
      </header>

      <section className="debug-panel">
        <label className="field">
          <span>Model</span>
          {modelsError ? (
            <span className="error">Ollama unreachable: {modelsError}</span>
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {models.length === 0 && <option>loading…</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.details?.parameter_size
                    ? ` · ${m.details.parameter_size}`
                    : ""}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="field">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask Ollama anything…"
            rows={4}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
          />
        </label>

        <div className="row">
          <button onClick={send} disabled={streaming || !selectedModel}>
            {streaming ? "streaming…" : "send (Ctrl+Enter)"}
          </button>
          {meta && (
            <span className="meta">
              prompt: {meta.prompt_eval_count ?? "—"} · reply:{" "}
              {meta.eval_count ?? "—"} · total: {ms(meta.total_duration_ns)}
            </span>
          )}
        </div>

        {error && <div className="error">error: {error}</div>}

        <pre className="response" ref={responseRef}>
          {response || (streaming ? "…" : "(no response yet)")}
        </pre>
      </section>
    </main>
  );
}

export default App;
