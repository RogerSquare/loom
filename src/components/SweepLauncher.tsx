import { useState } from "react";

import { type Turn } from "../lib/ipc";
import { useLoom, type SweepMode } from "../lib/store";

interface Props {
  turn: Turn;
  onClose: () => void;
}

export function SweepLauncher({ turn, onClose }: Props) {
  const startSweep = useLoom((s) => s.startSweep);
  const [n, setN] = useState(5);
  const [mode, setMode] = useState<SweepMode>("seed");
  const [busy, setBusy] = useState(false);

  const kick = async () => {
    if (busy) return;
    setBusy(true);
    await startSweep(turn.id, {
      n,
      mode,
      baseOptions: {
        temperature: 0.7,
        top_p: 0.9,
        num_ctx: 8192,
      },
    });
    // Modal switches from launcher to results (handled by parent).
    onClose();
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel sweep-launcher"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>variance sweep — configure</span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sweep-launcher-body">
          <label className="field">
            <span>Number of runs</span>
            <input
              type="number"
              min={2}
              max={20}
              value={n}
              onChange={(e) =>
                setN(Math.max(2, Math.min(20, Number(e.target.value) || 5)))
              }
            />
          </label>
          <label className="field">
            <span>Vary</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as SweepMode)}>
              <option value="seed">seed (same temp, different seeds)</option>
              <option value="temperature">
                temperature (same seed, 0.2 → 1.2)
              </option>
            </select>
          </label>
          <p className="muted">
            Re-runs the prompt that produced this turn <strong>{n}</strong>{" "}
            times. Results stream into a preview; you commit or discard after.
          </p>
        </div>
        <footer>
          <div className="row">
            <button onClick={onClose} disabled={busy}>
              cancel
            </button>
            <button className="primary" onClick={kick} disabled={busy}>
              {busy ? "starting…" : "start sweep"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
