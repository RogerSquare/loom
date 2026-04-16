import { useEffect, useRef, useState } from "react";

import { garakScan } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Props {
  onClose: () => void;
}

type Line = { stream: "out" | "err"; text: string };

export function GarakModal({ onClose }: Props) {
  const current = useLoom((s) => s.current);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState("latentinjection");
  const [generations, setGenerations] = useState(3);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!current) return null;

  const kick = async () => {
    if (running) return;
    setRunning(true);
    setLines([]);
    setReportPath(null);
    setExitCode(null);
    setError(null);
    try {
      await garakScan(current.session.model, probes, generations, (ev) => {
        if (ev.kind === "stdout") {
          setLines((ls) => [...ls, { stream: "out", text: ev.line }]);
        } else if (ev.kind === "stderr") {
          setLines((ls) => [...ls, { stream: "err", text: ev.line }]);
        } else if (ev.kind === "done") {
          setExitCode(ev.exit_code);
          setReportPath(ev.report_path);
          setRunning(false);
        } else if (ev.kind === "error") {
          setError(ev.message);
          setRunning(false);
        }
      });
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
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
          </span>
          <button className="icon-button" onClick={onClose}>
            ×
          </button>
        </header>

        {!running && lines.length === 0 && (
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
              Requires <code>garak</code> on PATH (<code>pipx install garak</code>).
              Runs against the active Ollama model. A single probe typically takes 1–3 minutes.
            </p>
          </div>
        )}

        {(running || lines.length > 0) && (
          <pre className="garak-log" ref={logRef}>
            {lines.map((l, i) => (
              <span key={i} className={l.stream === "err" ? "garak-err" : "garak-out"}>
                {l.text}
                {"\n"}
              </span>
            ))}
            {running && <span className="garak-cursor">▍</span>}
          </pre>
        )}

        {error && <div className="error">{error}</div>}

        {reportPath && (
          <div className="garak-report">
            <span className="muted">report:</span>{" "}
            <code>{reportPath}</code>
          </div>
        )}

        <footer>
          <span className="muted">
            {running
              ? "scanning…"
              : exitCode != null
                ? `exit ${exitCode}`
                : "not started"}
          </span>
          <div className="row">
            <button onClick={onClose} disabled={running}>
              close
            </button>
            <button
              className="primary"
              onClick={kick}
              disabled={running || !probes.trim()}
            >
              {lines.length > 0 ? "run again" : "start scan"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
