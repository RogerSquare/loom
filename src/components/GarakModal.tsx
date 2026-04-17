import { useEffect, useRef, useState } from "react";

import { useLoom } from "../lib/store";

interface Props {
  onClose: () => void;
}

export function GarakModal({ onClose }: Props) {
  const current = useLoom((s) => s.current);
  const garak = useLoom((s) => s.garak);
  const startGarak = useLoom((s) => s.startGarak);
  const cancelGarak = useLoom((s) => s.cancelGarak);
  const clearGarak = useLoom((s) => s.clearGarak);
  const [probes, setProbes] = useState("latentinjection");
  const [generations, setGenerations] = useState(3);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [garak.lines.length]);

  if (!current) return null;

  const hasRun = garak.lines.length > 0 || garak.running;

  const kick = () => {
    startGarak(probes, generations);
  };

  return (
    <div className="edit-panel-overlay" onClick={onClose}>
      <div
        className="edit-panel garak-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span>
            garak scan — model <strong>{current.session.model}</strong>
            {garak.running && " — running…"}
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>

        {!hasRun && (
          <div className="garak-launcher">
            <label className="field">
              <span>Probes (comma-separated, or module name)</span>
              <input value={probes} onChange={(e) => setProbes(e.target.value)} />
            </label>
            <label className="field">
              <span>Generations per prompt</span>
              <input
                type="number"
                min={1}
                max={20}
                value={generations}
                onChange={(e) => setGenerations(Number(e.target.value) || 3)}
              />
            </label>
            <p className="muted">
              Requires <code>garak</code> on PATH (<code>pip install garak</code>).
              Runs against the active Ollama model. A single probe module
              typically takes 1–10 minutes.
            </p>
          </div>
        )}

        {hasRun && (
          <pre className="garak-log" ref={logRef}>
            {garak.lines.map((l, i) => (
              <span
                key={i}
                className={l.stream === "err" ? "garak-err" : "garak-out"}
              >
                {l.text}
                {"\n"}
              </span>
            ))}
            {garak.running && <span className="garak-cursor">▍</span>}
          </pre>
        )}

        {garak.error && <div className="error">{garak.error}</div>}

        {garak.reportPath && (
          <div className="garak-report">
            <span className="muted">report:</span>{" "}
            <code>{garak.reportPath}</code>
          </div>
        )}

        <footer>
          <span className="muted">
            {garak.running
              ? "scanning… (close this modal without losing progress)"
              : garak.exitCode != null
                ? `exit ${garak.exitCode}`
                : "not started"}
          </span>
          <div className="row">
            {garak.running ? (
              <button onClick={cancelGarak}>cancel scan</button>
            ) : (
              <>
                {hasRun && (
                  <button onClick={clearGarak}>clear log</button>
                )}
                <button onClick={onClose}>close</button>
                <button
                  className="primary"
                  onClick={kick}
                  disabled={garak.running || !probes.trim()}
                >
                  {hasRun ? "run again" : "start scan"}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
