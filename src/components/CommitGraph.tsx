import { useMemo } from "react";

import { branchColors } from "../lib/branchColors";
import { buildTimeline, type SessionFile, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Node {
  turn: Turn;
  lane: number;
  row: number;
  branchId: string;
}

interface Edge {
  from: Node;
  to: Node;
  onActivePath: boolean;
}

const LANE_W = 22;
const ROW_H = 24;
const NODE_R = 4.5;
const PAD = 14;

/**
 * Stable lane assignment: branches sorted by created_at (oldest → lane 0).
 * A turn's lane is the lowest-indexed branch whose chain contains it.
 * Graph shape is invariant across checkouts — HEAD is conveyed via color
 * weight, not layout.
 */
function layout(file: SessionFile): {
  nodes: Node[];
  edges: Edge[];
  laneToBranch: (string | undefined)[];
  activeTurnIds: Set<string>;
} {
  const branchIds = Object.keys(file.branches).sort((a, b) =>
    file.branches[a].created_at.localeCompare(file.branches[b].created_at),
  );

  const turnLane = new Map<string, number>();
  const turnBranch = new Map<string, string>();
  const laneToBranch: (string | undefined)[] = [];

  branchIds.forEach((bid, lane) => {
    laneToBranch[lane] = bid;
    const chain = buildTimeline(file, bid);
    for (const t of chain) {
      if (!turnLane.has(t.id)) {
        turnLane.set(t.id, lane);
        turnBranch.set(t.id, bid);
      }
    }
  });

  const sortedTurns = Object.values(file.turns).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const rowOf = new Map<string, number>();
  sortedTurns.forEach((t, i) => rowOf.set(t.id, i));

  const nodes: Node[] = sortedTurns.map((t) => ({
    turn: t,
    lane: turnLane.get(t.id) ?? 0,
    row: rowOf.get(t.id) ?? 0,
    branchId: turnBranch.get(t.id) ?? (laneToBranch[0] ?? ""),
  }));
  const nodeById = new Map(nodes.map((n) => [n.turn.id, n]));

  const activeChain = buildTimeline(file);
  const activeTurnIds = new Set(activeChain.map((t) => t.id));

  const edges: Edge[] = [];
  for (const n of nodes) {
    if (n.turn.parent) {
      const p = nodeById.get(n.turn.parent);
      if (p) {
        const onActivePath =
          activeTurnIds.has(p.turn.id) && activeTurnIds.has(n.turn.id);
        edges.push({ from: p, to: n, onActivePath });
      }
    }
  }

  return { nodes, edges, laneToBranch, activeTurnIds };
}

function roleClass(role: Turn["role"]): string {
  return `node-${role}`;
}

export function CommitGraph() {
  const current = useLoom((s) => s.current);
  const checkoutBranch = useLoom((s) => s.checkoutBranch);

  const { nodes, edges, laneToBranch, activeTurnIds, colors, width, height } =
    useMemo(() => {
      if (!current)
        return {
          nodes: [] as Node[],
          edges: [] as Edge[],
          laneToBranch: [] as (string | undefined)[],
          activeTurnIds: new Set<string>(),
          colors: new Map<string, string>(),
          width: 0,
          height: 0,
        };
      const l = layout(current);
      const colors = branchColors(current);
      const maxLane = l.nodes.reduce((m, n) => Math.max(m, n.lane), 0);
      const maxRow = l.nodes.reduce((m, n) => Math.max(m, n.row), 0);
      return {
        ...l,
        colors,
        width: PAD * 2 + (maxLane + 1) * LANE_W,
        height: PAD * 2 + (maxRow + 1) * ROW_H,
      };
    }, [current]);

  if (!current || nodes.length === 0) return null;

  const x = (lane: number) => PAD + lane * LANE_W;
  const y = (row: number) => PAD + row * ROW_H;

  const headTurnId = current.branches[current.head_branch]?.head ?? null;

  return (
    <aside className="commit-graph">
      <div className="commit-graph-label">history</div>
      <svg width={width} height={height} className="commit-graph-svg">
        {/* Inactive edges first, active last so they paint on top. */}
        {edges
          .slice()
          .sort((a, b) => Number(a.onActivePath) - Number(b.onActivePath))
          .map((e, i) => {
            const x1 = x(e.from.lane);
            const y1 = y(e.from.row);
            const x2 = x(e.to.lane);
            const y2 = y(e.to.row);
            const stroke = colors.get(e.to.branchId) ?? "#444";
            const opacity = e.onActivePath ? 1 : 0.4;
            const width = e.onActivePath ? 2 : 1.3;
            if (x1 === x2) {
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={width}
                  opacity={opacity}
                />
              );
            }
            // Cross-lane: elbow right below the parent, then straight down in
            // the child's lane. Anchors the fork at the parent's row.
            const turnY = y1 + ROW_H / 2;
            const r = 6;
            const horizDir = x2 > x1 ? 1 : -1;
            const d =
              `M ${x1} ${y1} ` +
              `L ${x1} ${turnY - r} ` +
              `Q ${x1} ${turnY} ${x1 + horizDir * r} ${turnY} ` +
              `L ${x2 - horizDir * r} ${turnY} ` +
              `Q ${x2} ${turnY} ${x2} ${turnY + r} ` +
              `L ${x2} ${y2}`;
            return (
              <path
                key={i}
                d={d}
                stroke={stroke}
                strokeWidth={width}
                opacity={opacity}
                fill="none"
              />
            );
          })}
        {nodes.map((n) => {
          const isHead = n.turn.id === headTurnId;
          const isOnActivePath = activeTurnIds.has(n.turn.id);
          const targetBranch = laneToBranch[n.lane];
          const branchName = targetBranch
            ? current.branches[targetBranch].name
            : "";
          const branchColor = colors.get(n.branchId) ?? "#444";
          return (
            <g
              key={n.turn.id}
              className={
                "node " +
                roleClass(n.turn.role) +
                (isHead ? " head" : "") +
                (isOnActivePath ? " active" : "") +
                (targetBranch ? " clickable" : "")
              }
              onClick={() => {
                if (targetBranch && targetBranch !== current.head_branch) {
                  checkoutBranch(targetBranch);
                }
              }}
            >
              <title>
                {n.turn.role} · {n.turn.content.slice(0, 60)}
                {branchName ? `\n→ click to checkout "${branchName}"` : ""}
                {isHead ? "\n(HEAD)" : ""}
              </title>
              <circle
                cx={x(n.lane)}
                cy={y(n.row)}
                r={isHead ? NODE_R + 1.5 : NODE_R}
                stroke={branchColor}
                strokeWidth={isHead ? 2.5 : isOnActivePath ? 1.5 : 1}
                opacity={isOnActivePath ? 1 : 0.55}
              />
            </g>
          );
        })}
      </svg>
    </aside>
  );
}
