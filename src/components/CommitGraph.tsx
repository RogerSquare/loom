import { useMemo } from "react";

import { buildTimeline, type SessionFile, type Turn } from "../lib/ipc";
import { useLoom } from "../lib/store";

interface Node {
  turn: Turn;
  lane: number;
  row: number;
}

interface Edge {
  from: Node;
  to: Node;
}

const LANE_W = 22;
const ROW_H = 22;
const NODE_R = 4.5;
const PAD = 12;

/**
 * Compute a lane assignment for every turn in the session.
 * Strategy: walk each branch's head→root chain; first write wins. The active
 * branch gets lane 0; other branches fill in to the right.
 */
function layout(file: SessionFile): { nodes: Node[]; edges: Edge[] } {
  const lanes = new Map<string, number>();

  // Sort branches so that head_branch is first (lane 0), others by created_at
  const branchIds = Object.keys(file.branches).sort((a, b) => {
    if (a === file.head_branch) return -1;
    if (b === file.head_branch) return 1;
    return file.branches[a].created_at.localeCompare(file.branches[b].created_at);
  });

  let nextLane = 0;
  for (const bid of branchIds) {
    const lane = nextLane++;
    const chain = buildTimeline(file, bid);
    for (const t of chain) {
      if (!lanes.has(t.id)) lanes.set(t.id, lane);
    }
  }

  // Row = chronological index over ALL turns
  const sortedTurns = Object.values(file.turns).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const rowOf = new Map<string, number>();
  sortedTurns.forEach((t, i) => rowOf.set(t.id, i));

  const nodes: Node[] = sortedTurns.map((t) => ({
    turn: t,
    lane: lanes.get(t.id) ?? 0,
    row: rowOf.get(t.id) ?? 0,
  }));
  const nodeById = new Map(nodes.map((n) => [n.turn.id, n]));

  const edges: Edge[] = [];
  for (const n of nodes) {
    if (n.turn.parent) {
      const p = nodeById.get(n.turn.parent);
      if (p) edges.push({ from: p, to: n });
    }
  }

  return { nodes, edges };
}

function roleClass(role: Turn["role"]): string {
  return `node-${role}`;
}

export function CommitGraph() {
  const current = useLoom((s) => s.current);
  const checkoutBranch = useLoom((s) => s.checkoutBranch);

  const { nodes, edges, width, height } = useMemo(() => {
    if (!current)
      return { nodes: [] as Node[], edges: [] as Edge[], width: 0, height: 0 };
    const { nodes, edges } = layout(current);
    const maxLane = nodes.reduce((m, n) => Math.max(m, n.lane), 0);
    const maxRow = nodes.reduce((m, n) => Math.max(m, n.row), 0);
    return {
      nodes,
      edges,
      width: PAD * 2 + (maxLane + 1) * LANE_W,
      height: PAD * 2 + (maxRow + 1) * ROW_H,
    };
  }, [current]);

  if (!current || nodes.length === 0) return null;

  const x = (lane: number) => PAD + lane * LANE_W;
  const y = (row: number) => PAD + row * ROW_H;

  // Branch head → branch_id map, for click-to-checkout on head nodes
  const headToBranch = new Map<string, string>();
  for (const [bid, b] of Object.entries(current.branches)) {
    if (!headToBranch.has(b.head)) headToBranch.set(b.head, bid);
  }

  return (
    <aside className="commit-graph">
      <div className="commit-graph-label">history</div>
      <svg width={width} height={height} className="commit-graph-svg">
        {edges.map((e, i) => {
          const x1 = x(e.from.lane);
          const y1 = y(e.from.row);
          const x2 = x(e.to.lane);
          const y2 = y(e.to.row);
          if (x1 === x2) {
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className="edge"
              />
            );
          }
          // S-curve between lanes
          const mid = (y1 + y2) / 2;
          const d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
          return <path key={i} d={d} className="edge" fill="none" />;
        })}
        {nodes.map((n) => {
          const bid = headToBranch.get(n.turn.id);
          const isHead =
            bid === current.head_branch ||
            (bid && current.branches[bid]?.head === n.turn.id);
          return (
            <g
              key={n.turn.id}
              className={
                "node " + roleClass(n.turn.role) + (bid ? " clickable" : "")
              }
              onClick={() => {
                if (bid) checkoutBranch(bid);
              }}
            >
              <title>
                {n.turn.role} · {n.turn.content.slice(0, 60)}
                {bid ? `\nbranch: ${current.branches[bid].name}` : ""}
              </title>
              <circle
                cx={x(n.lane)}
                cy={y(n.row)}
                r={isHead ? NODE_R + 1 : NODE_R}
                strokeWidth={isHead ? 2 : 1}
              />
            </g>
          );
        })}
      </svg>
    </aside>
  );
}
