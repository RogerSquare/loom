import { useMemo } from "react";

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
 * This means the overall graph shape does NOT change when the user switches
 * the active branch — HEAD is communicated by color, not by layout.
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

  const { nodes, edges, laneToBranch, activeTurnIds, width, height } = useMemo(() => {
    if (!current)
      return {
        nodes: [] as Node[],
        edges: [] as Edge[],
        laneToBranch: [] as (string | undefined)[],
        activeTurnIds: new Set<string>(),
        width: 0,
        height: 0,
      };
    const l = layout(current);
    const maxLane = l.nodes.reduce((m, n) => Math.max(m, n.lane), 0);
    const maxRow = l.nodes.reduce((m, n) => Math.max(m, n.row), 0);
    return {
      ...l,
      width: PAD * 2 + (maxLane + 1) * LANE_W,
      height: PAD * 2 + (maxRow + 1) * ROW_H,
    };
  }, [current]);

  if (!current || nodes.length === 0) return null;

  const x = (lane: number) => PAD + lane * LANE_W;
  const y = (row: number) => PAD + row * ROW_H;

  const headTurnId =
    current.branches[current.head_branch]?.head ?? null;

  return (
    <aside className="commit-graph">
      <div className="commit-graph-label">history</div>
      <svg width={width} height={height} className="commit-graph-svg">
        {/* passive edges first, active last so they paint on top */}
        {edges
          .slice()
          .sort((a, b) => Number(a.onActivePath) - Number(b.onActivePath))
          .map((e, i) => {
            const x1 = x(e.from.lane);
            const y1 = y(e.from.row);
            const x2 = x(e.to.lane);
            const y2 = y(e.to.row);
            const cls = "edge" + (e.onActivePath ? " active" : "");
            if (x1 === x2) {
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={cls} />
              );
            }
            const mid = (y1 + y2) / 2;
            const d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
            return <path key={i} d={d} className={cls} fill="none" />;
          })}
        {nodes.map((n) => {
          const isHead = n.turn.id === headTurnId;
          const isOnActivePath = activeTurnIds.has(n.turn.id);
          const targetBranch = laneToBranch[n.lane];
          const branchName = targetBranch
            ? current.branches[targetBranch].name
            : "";
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
              />
            </g>
          );
        })}
      </svg>
    </aside>
  );
}
