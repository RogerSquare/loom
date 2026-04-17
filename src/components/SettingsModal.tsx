import { useEffect, useState } from "react";

import {
  llmListModels,
  settingsLoad,
  settingsSave,
  type AppSettings,
} from "../lib/ipc";

interface Props {
  onClose: () => void;
}

type SettingsPage = "connectors" | "appearance" | "defaults" | "about";

const PAGES: { id: SettingsPage; label: string }[] = [
  { id: "connectors", label: "Connectors" },
  { id: "appearance", label: "Appearance" },
  { id: "defaults", label: "Defaults" },
  { id: "about", label: "About" },
];

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  if (theme === "dark" || theme === "light") {
    root.classList.add(theme);
  }
}

// ── Connectors page ──

function ConnectorsPage({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [ollamaModels, setOllamaModels] = useState<number | null>(null);
  const [anthropicStatus, setAnthropicStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [anthropicModels, setAnthropicModels] = useState<number | null>(null);

  const testOllama = async () => {
    setOllamaStatus("testing");
    try {
      const models = await llmListModels("ollama");
      setOllamaModels(models.length);
      setOllamaStatus(models.length > 0 ? "ok" : "error");
    } catch {
      setOllamaStatus("error");
      setOllamaModels(null);
    }
  };

  const testAnthropic = async () => {
    setAnthropicStatus("testing");
    try {
      const models = await llmListModels("anthropic");
      setAnthropicModels(models.length);
      setAnthropicStatus("ok");
    } catch {
      setAnthropicStatus("error");
      setAnthropicModels(null);
    }
  };

  const hasAnthropicKey = !!(settings.api_keys?.anthropic);

  return (
    <div className="settings-page">
      <h3 className="settings-page-title">Connectors</h3>
      <p className="settings-page-desc">
        Configure LLM providers. Each connector can be tested independently.
      </p>

      {/* Ollama card */}
      <div className="connector-card">
        <div className="connector-header">
          <div className="connector-info">
            <span className="connector-name">Ollama</span>
            <span className="connector-badge local">local</span>
          </div>
          <span className={`status-dot status-${ollamaStatus === "ok" ? "ok" : ollamaStatus === "error" ? "error" : "idle"}`} />
        </div>
        <label className="field">
          <span>Endpoint</span>
          <input
            value={settings.ollama_endpoint}
            onChange={(e) => update({ ollama_endpoint: e.target.value })}
            placeholder="http://localhost:11434"
          />
        </label>
        <div className="connector-actions">
          <button
            onClick={testOllama}
            disabled={ollamaStatus === "testing"}
            className="connector-test-btn"
          >
            {ollamaStatus === "testing" ? "testing..." : "test connection"}
          </button>
          {ollamaStatus === "ok" && (
            <span className="connector-result ok">{ollamaModels} models available</span>
          )}
          {ollamaStatus === "error" && (
            <span className="connector-result error">connection failed</span>
          )}
        </div>
        <small className="muted">
          Run <code>ollama serve</code> to start. Requires app restart if endpoint changes.
        </small>
      </div>

      {/* Anthropic card */}
      <div className="connector-card">
        <div className="connector-header">
          <div className="connector-info">
            <span className="connector-name">Anthropic Claude</span>
            <span className="connector-badge cloud">cloud</span>
          </div>
          <span className={`status-dot status-${hasAnthropicKey ? (anthropicStatus === "ok" ? "ok" : "idle") : "unconfigured"}`} />
        </div>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={settings.api_keys?.anthropic ?? ""}
            onChange={(e) =>
              update({
                api_keys: { ...settings.api_keys, anthropic: e.target.value },
              })
            }
          />
        </label>
        <div className="connector-actions">
          <button
            onClick={testAnthropic}
            disabled={!hasAnthropicKey || anthropicStatus === "testing"}
            className="connector-test-btn"
          >
            {anthropicStatus === "testing" ? "testing..." : "test connection"}
          </button>
          {anthropicStatus === "ok" && (
            <span className="connector-result ok">{anthropicModels} models available</span>
          )}
          {anthropicStatus === "error" && (
            <span className="connector-result error">connection failed</span>
          )}
          {!hasAnthropicKey && (
            <span className="connector-result muted">no key configured</span>
          )}
        </div>
        <small className="muted">
          Get a key at console.anthropic.com. Supports Claude Opus 4, Sonnet 4, Haiku 4.5.
        </small>
      </div>
    </div>
  );
}

// ── Appearance page ──

function AppearancePage({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <div className="settings-page">
      <h3 className="settings-page-title">Appearance</h3>
      <p className="settings-page-desc">
        Customize how Loom looks. Theme changes apply immediately on save.
      </p>

      <label className="field">
        <span>Theme</span>
        <div className="theme-picker">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              className={`theme-option${settings.theme === t ? " active" : ""}`}
              onClick={() => update({ theme: t })}
            >
              <span className={`theme-preview theme-preview-${t}`} />
              <span>{t}</span>
            </button>
          ))}
        </div>
      </label>
    </div>
  );
}

// ── Defaults page ──

function DefaultsPage({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <div className="settings-page">
      <h3 className="settings-page-title">Defaults</h3>
      <p className="settings-page-desc">
        Default sampling parameters applied to new sessions.
      </p>

      <div className="settings-row">
        <label className="field">
          <span>temperature</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={settings.default_temperature}
            onChange={(e) =>
              update({ default_temperature: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>top_p</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={settings.default_top_p}
            onChange={(e) =>
              update({ default_top_p: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>num_ctx</span>
          <input
            type="number"
            min={512}
            max={131072}
            step={512}
            value={settings.default_num_ctx}
            onChange={(e) =>
              update({ default_num_ctx: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>seed</span>
          <input
            type="text"
            placeholder="(random)"
            value={settings.default_seed?.toString() ?? ""}
            onChange={(e) =>
              update({
                default_seed: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
      </div>

      <label className="field">
        <span>Default context limit (turns, blank = unlimited)</span>
        <input
          type="number"
          min={1}
          placeholder="unlimited"
          value={settings.default_context_limit?.toString() ?? ""}
          onChange={(e) =>
            update({
              default_context_limit: e.target.value
                ? Number(e.target.value)
                : undefined,
            })
          }
        />
      </label>
    </div>
  );
}

// ── About page ──

function AboutPage() {
  return (
    <div className="settings-page">
      <h3 className="settings-page-title">About</h3>
      <div className="about-content">
        <div className="about-logo">LOOM</div>
        <p className="about-version">v0.1.0</p>
        <p className="about-desc">
          Local-first LLM context-editing harness with branching conversations,
          variance sweeps, and multi-provider support.
        </p>

        <h4>Keyboard shortcuts</h4>
        <table className="shortcuts-table">
          <tbody>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Send message</td></tr>
            <tr><td><kbd>?</kbd></td><td>Toggle shortcuts overlay</td></tr>
            <tr><td>Double-click title</td><td>Rename session</td></tr>
          </tbody>
        </table>

        <h4>Links</h4>
        <p className="muted">
          Built with Tauri + React + Rust. Supports Ollama and Anthropic Claude.
        </p>
      </div>
    </div>
  );
}

// ── Main settings modal ──

export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [page, setPage] = useState<SettingsPage>("connectors");

  useEffect(() => {
    settingsLoad().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;

  const update = (patch: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      await settingsSave(settings);
      applyTheme(settings.theme);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>Settings</span>
          <button className="icon-button" onClick={onClose} aria-label="close settings">
            x
          </button>
        </header>

        <div className="settings-layout">
          {/* Sidebar nav */}
          <nav className="settings-nav">
            {PAGES.map((p) => (
              <button
                key={p.id}
                className={`settings-nav-item${page === p.id ? " active" : ""}`}
                onClick={() => setPage(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>

          {/* Content area */}
          <div className="settings-content">
            {page === "connectors" && (
              <ConnectorsPage settings={settings} update={update} />
            )}
            {page === "appearance" && (
              <AppearancePage settings={settings} update={update} />
            )}
            {page === "defaults" && (
              <DefaultsPage settings={settings} update={update} />
            )}
            {page === "about" && <AboutPage />}
          </div>
        </div>

        <footer>
          <span className="muted">
            {saved ? "saved" : saving ? "saving..." : ""}
          </span>
          <div className="row">
            <button onClick={onClose}>close</button>
            <button className="primary" onClick={save} disabled={saving}>
              save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
