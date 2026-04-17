import { useEffect, useState } from "react";

import {
  settingsLoad,
  settingsSave,
  type AppSettings,
} from "../lib/ipc";

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>settings</span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="settings-body">
          <label className="field">
            <span>Ollama endpoint</span>
            <input
              value={settings.ollama_endpoint}
              onChange={(e) => update({ ollama_endpoint: e.target.value })}
              placeholder="http://localhost:11434"
            />
            <small className="muted">
              requires app restart to take effect
            </small>
          </label>

          <fieldset className="settings-group">
            <legend>Default sampling params (for new sessions)</legend>
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
          </fieldset>

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

          <label className="field">
            <span>Theme</span>
            <select
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value })}
            >
              <option value="dark">dark</option>
              <option value="light">light (coming soon)</option>
            </select>
          </label>
        </div>

        <footer>
          <span className="muted">
            {saved ? "saved ✓" : saving ? "saving…" : ""}
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
