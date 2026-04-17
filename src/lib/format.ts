// feat-loom-043: display formatters for observability fields.

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "";
  if (usd < 0) return `-${formatCost(-usd)}`;
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDurationMs(ns: number): string {
  return `${(ns / 1_000_000).toFixed(0)} ms`;
}
