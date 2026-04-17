import { useMemo } from "react";

import { useLoom } from "../lib/store";

export function SweepModal() {
  const sweep = useLoom((s) => s.sweep);
  const commitSweep = useLoom((s) => s.commitSweep);
  const discardSweep = useLoom((s) => s.discardSweep);

  const runs = sweep?.runs ?? [];
  const allDone = runs.length > 0 && runs.every((r) => r.status === "done" || r.status === "error");
  const progress = runs.filter((r) => r.status === "done").length;

  const consistency = useMemo(() => {
    const done = runs.filter((r) => r.status === "done" && r.content.trim());
    if (done.length === 0)
      return { unique: 0, agreement: 0, majority: "", majorityCount: 0 };
    const freq = new Map<string, number>();
    for (const r of done) {
      const key = r.content.trim();
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    const unique = freq.size;
    let majority = "";
    let majorityCount = 0;
    for (const [text, count] of freq) {
      if (count > majorityCount) {
        majority = text;
        majorityCount = count;
      }
    }
    const agreement = Math.round((majorityCount / done.length) * 100);
    return { unique, agreement, majority, majorityCount };
  }, [runs]);
  const uniqueCount = consistency.unique;

  if (!sweep) return null;

  return (
    <div className="edit-panel-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="edit-panel sweep-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <span>
            variance sweep — <strong>{progress}</strong>/{runs.length} done
            {allDone && (
              <>
                {" "}· <strong>{uniqueCount}</strong> unique response
                {uniqueCount === 1 ? "" : "s"}
              </>
            )}
          </span>
          <button className="icon-button" onClick={discardSweep}>
            ×
          </button>
        </header>

        <div className="sweep-runs">
          {runs.map((r, i) => (
            <div key={r.id} className={`sweep-run sweep-${r.status}`}>
              <div className="sweep-run-head">
                <span className="sweep-index">#{i + 1}</span>
                <span className="sweep-meta">
                  {sweep.mode === "seed"
                    ? `seed ${r.seed}`
                    : `temp ${r.temperature.toFixed(2)}`}
                  {r.eval_count != null && ` · ${r.eval_count} tok`}
                </span>
                <span className={`sweep-status status-${r.status}`}>
                  {r.status}
                </span>
              </div>
              <pre className="sweep-run-body">
                {r.content || (r.status === "pending" || r.status === "streaming" ? "…" : "")}
                {r.error && <span className="error">{r.error}</span>}
              </pre>
            </div>
          ))}
        </div>

        {allDone && consistency.unique > 0 && (
          <div className="sweep-consistency">
            <div className="consistency-bar">
              <div
                className="consistency-fill"
                style={{ width: `${consistency.agreement}%` }}
              />
            </div>
            <div className="consistency-stats">
              <span>
                agreement: <strong>{consistency.agreement}%</strong>
              </span>
              <span>
                unique: <strong>{consistency.unique}</strong> /{" "}
                {runs.filter((r) => r.status === "done").length}
              </span>
              {consistency.agreement === 100 && (
                <span className="consistency-badge perfect">identical</span>
              )}
              {consistency.agreement < 100 && consistency.majorityCount > 1 && (
                <span className="consistency-badge majority">
                  majority: {consistency.majorityCount} agree
                </span>
              )}
            </div>
          </div>
        )}

        <footer>
          <span className="muted">
            {sweep.mode === "seed"
              ? "all runs share the same temperature; seeds vary"
              : "all runs share the same seed; temperature varies 0.2 → 1.2"}
          </span>
          <div className="row">
            <button onClick={discardSweep} disabled={!allDone && runs.some((r) => r.status === "streaming")}>
              discard
            </button>
            <button
              className="primary"
              onClick={commitSweep}
              disabled={!allDone}
            >
              commit all as branches
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
