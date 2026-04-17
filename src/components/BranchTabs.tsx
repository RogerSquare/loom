import { useMemo } from "react";

import { branchColors } from "../lib/branchColors";
import { formatCost } from "../lib/format";
import { computeBranchStats } from "../lib/stats";
import { useLoom } from "../lib/store";

export function BranchTabs() {
  const current = useLoom((s) => s.current);
  const checkoutBranch = useLoom((s) => s.checkoutBranch);
  const colors = useMemo(
    () => (current ? branchColors(current) : new Map<string, string>()),
    [current],
  );
  const branchStats = useMemo(() => {
    if (!current) return new Map<string, ReturnType<typeof computeBranchStats>>();
    const m = new Map<string, ReturnType<typeof computeBranchStats>>();
    for (const bid of Object.keys(current.branches)) {
      m.set(bid, computeBranchStats(current, bid));
    }
    return m;
  }, [current]);

  if (!current) return null;

  const branchEntries = Object.entries(current.branches).sort(
    ([, a], [, b]) => a.created_at.localeCompare(b.created_at),
  );

  return (
    <div className="branch-tabs">
      {branchEntries.map(([bid, b]) => {
        const isHead = bid === current.head_branch;
        const color = colors.get(bid) ?? "#6aa9e0";
        const stats = branchStats.get(bid);
        const forkedAt = b.forked_at
          ? `forked at ${b.forked_at.slice(0, 8)}…`
          : "root branch";
        const statsLine = stats
          ? `${stats.turn_count} turn${stats.turn_count === 1 ? "" : "s"}`
            + (stats.total_cost_usd > 0 ? ` · ${formatCost(stats.total_cost_usd)}` : "")
            + (stats.total_duration_ms > 0
              ? ` · ${(stats.total_duration_ms / 1000).toFixed(1)}s`
              : "")
          : "";
        const tooltip = statsLine ? `${forkedAt}\n${statsLine}` : forkedAt;
        return (
          <button
            key={bid}
            className={isHead ? "branch-tab active" : "branch-tab"}
            onClick={() => checkoutBranch(bid)}
            style={
              {
                "--branch-color": color,
              } as React.CSSProperties
            }
            title={tooltip}
          >
            <span className="branch-marker" style={{ color }}>
              ●
            </span>
            {b.name}
          </button>
        );
      })}
    </div>
  );
}
