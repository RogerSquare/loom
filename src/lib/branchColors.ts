import { type SessionFile } from "./ipc";

// Palette tuned for the dark theme — each hue visually distinct at the small
// sizes used in the commit graph and branch tabs.
const PALETTE = [
  "#6aa9e0", // blue
  "#7ec488", // green
  "#d08ad8", // purple
  "#e0a06a", // orange
  "#e66a8a", // pink
  "#6ad0c8", // teal
  "#d8c868", // yellow
  "#9a90e8", // indigo
];

/**
 * Stable color assignment by branch creation order. Matches the commit-graph
 * lane ordering so a branch's color, its tab, and its lane are one and the same.
 */
export function branchColors(file: SessionFile): Map<string, string> {
  const sorted = Object.keys(file.branches).sort((a, b) =>
    file.branches[a].created_at.localeCompare(file.branches[b].created_at),
  );
  const map = new Map<string, string>();
  sorted.forEach((bid, i) => map.set(bid, PALETTE[i % PALETTE.length]));
  return map;
}

export function branchColor(file: SessionFile, branchId: string): string {
  return branchColors(file).get(branchId) ?? PALETTE[0];
}
