import { useMemo } from "react";

import { branchColors } from "../lib/branchColors";
import { useLoom } from "../lib/store";

export function BranchTabs() {
  const current = useLoom((s) => s.current);
  const checkoutBranch = useLoom((s) => s.checkoutBranch);
  const colors = useMemo(
    () => (current ? branchColors(current) : new Map<string, string>()),
    [current],
  );
  if (!current) return null;

  const branchEntries = Object.entries(current.branches).sort(
    ([, a], [, b]) => a.created_at.localeCompare(b.created_at),
  );

  return (
    <div className="branch-tabs">
      {branchEntries.map(([bid, b]) => {
        const isHead = bid === current.head_branch;
        const color = colors.get(bid) ?? "#6aa9e0";
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
            title={
              b.forked_at ? `forked at ${b.forked_at.slice(0, 8)}…` : "root branch"
            }
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
