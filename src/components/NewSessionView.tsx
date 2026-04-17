import { useEffect, useMemo, useState } from "react";

import {
  llmListModels,
  promptList,
  type PromptEntry,
  type ProviderModelInfo,
} from "../lib/ipc";
import { useLoom } from "../lib/store";

/** Assistant preset — saved bundle of config for quick-start. */
interface Preset {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  systemPrompt: string;
}

const DEFAULT_PRESETS: Preset[] = [
  {
    id: "default-assistant",
    name: "General Assistant",
    description: "Helpful all-purpose assistant",
    provider: "ollama",
    model: "",
    systemPrompt: "You are a helpful assistant.",
  },
  {
    id: "code-review",
    name: "Code Reviewer",
    description: "Reviews code for bugs and improvements",
    provider: "ollama",
    model: "",
    systemPrompt:
      "You are a senior software engineer reviewing code. Be thorough, point out bugs, suggest improvements, and explain your reasoning.",
  },
  {
    id: "research",
    name: "Research Helper",
    description: "Analyzes topics and synthesizes findings",
    provider: "ollama",
    model: "",
    systemPrompt:
      "You are a research assistant. Analyze the topic thoroughly, cite sources when possible, and present findings in a structured format.",
  },
];

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem("loom_presets");
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_PRESETS;
}

export function NewSessionView() {
  const models = useLoom((s) => s.models);
  const modelsLoading = useLoom((s) => s.modelsLoading);
  const createSession = useLoom((s) => s.createSession);

  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [anthropicModels, setAnthropicModels] = useState<ProviderModelInfo[]>([]);
  const [presets] = useState<Preset[]>(() => loadPresets());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [numCtx, setNumCtx] = useState(8192);

  // Load prompts library
  useEffect(() => {
    promptList().then(setPrompts).catch(() => {});
  }, []);

  // Load anthropic models
  useEffect(() => {
    llmListModels("anthropic")
      .then(setAnthropicModels)
      .catch(() => {});
  }, []);

  // Set default model when models load
  useEffect(() => {
    if (provider === "ollama" && models.length > 0 && !model) {
      setModel(models[0].name);
    }
    if (provider === "anthropic" && anthropicModels.length > 0 && !model) {
      setModel(anthropicModels[0].id);
    }
  }, [models, anthropicModels, provider, model]);

  const currentModels = useMemo(() => {
    if (provider === "ollama") {
      return models.map((m) => ({ id: m.name, name: m.name, detail: m.details?.parameter_size }));
    }
    return anthropicModels.map((m) => ({ id: m.id, name: m.name, detail: undefined }));
  }, [provider, models, anthropicModels]);

  const switchProvider = (pid: string) => {
    setProvider(pid);
    setModel("");
  };

  const startFromPreset = async (preset: Preset) => {
    const p = preset.provider;
    const m =
      preset.model ||
      (p === "ollama" ? models[0]?.name : anthropicModels[0]?.id) ||
      "";
    if (!m) return;
    await createSession("untitled", m, preset.systemPrompt, p);
  };

  const startSession = async () => {
    if (!model) return;
    await createSession("untitled", model, systemPrompt, provider);
  };

  return (
    <div className="new-session-view">
      {/* Header bar with model picker */}
      <div className="nsv-header">
        <h1 className="nsv-logo">LOOM</h1>
        <div className="nsv-model-picker">
          <select
            className="nsv-provider-select"
            value={provider}
            onChange={(e) => switchProvider(e.target.value)}
          >
            <option value="ollama">Ollama</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <select
            className="nsv-model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {modelsLoading && provider === "ollama" && (
              <option>loading...</option>
            )}
            {currentModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.detail ? ` (${m.detail})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preset cards */}
      <div className="nsv-body">
        <p className="nsv-subtitle">Quick start with a preset, or configure below</p>

        <div className="nsv-presets">
          {presets.map((p) => (
            <button
              key={p.id}
              className="nsv-preset-card"
              onClick={() => startFromPreset(p)}
            >
              <span className="nsv-preset-name">{p.name}</span>
              <span className="nsv-preset-desc">{p.description}</span>
              <span className="nsv-preset-meta">
                <span className={`connector-badge ${p.provider === "ollama" ? "local" : "cloud"}`}>
                  {p.provider}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* System prompt */}
        <div className="nsv-section">
          <div className="nsv-section-header">
            <span className="nsv-section-label">System prompt</span>
            {prompts.length > 0 && (
              <select
                className="nsv-prompt-select"
                value=""
                onChange={(e) => {
                  const p = prompts.find((pr) => pr.name === e.target.value);
                  if (p) setSystemPrompt(p.content);
                }}
              >
                <option value="">load from library</option>
                {prompts.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          <textarea
            className="nsv-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="You are a helpful assistant."
          />
        </div>

        {/* Collapsible sampling options */}
        <button
          className="nsv-options-toggle"
          onClick={() => setOptionsOpen((v) => !v)}
        >
          {optionsOpen ? "Hide" : "Show"} sampling options
        </button>

        {optionsOpen && (
          <div className="nsv-options">
            <label className="field">
              <span>temperature</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </label>
            <label className="field">
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
            <label className="field">
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
          </div>
        )}

        {/* Start button */}
        <button
          className="nsv-start-btn"
          onClick={startSession}
          disabled={!model}
        >
          start session
        </button>
      </div>
    </div>
  );
}
