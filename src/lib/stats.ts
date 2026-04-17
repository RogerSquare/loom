// feat-loom-043: branch + session observability roll-ups.
//
// Turn-level observability lives on generated_by.response_meta (see
// feat-loom-043 phases 1–3). These helpers aggregate those per-turn values
// into branch- and session-level totals for the UI.

import type { SessionFile, Turn } from "./ipc";
import { buildTimeline } from "./ipc";

export interface Stats {
  turn_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_tokens: number;
  total_cost_usd: number;
  total_duration_ms: number;
}

function emptyStats(): Stats {
  return {
    turn_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cached_tokens: 0,
    total_cost_usd: 0,
    total_duration_ms: 0,
  };
}

function accumulate(stats: Stats, turn: Turn): void {
  stats.turn_count += 1;
  const meta = turn.generated_by?.response_meta;
  if (!meta) return;
  stats.total_input_tokens += meta.prompt_eval_count ?? 0;
  stats.total_output_tokens += meta.eval_count ?? 0;
  stats.total_cached_tokens += meta.cached_tokens ?? 0;
  stats.total_cost_usd += meta.cost_usd ?? 0;
  if (meta.total_duration_ns != null) {
    stats.total_duration_ms += meta.total_duration_ns / 1_000_000;
  }
}

/**
 * Roll up per-turn metadata for every turn in the given branch's timeline.
 * Branch timeline = root → head chain via parent pointers (see buildTimeline).
 */
export function computeBranchStats(file: SessionFile, branchId: string): Stats {
  const chain = buildTimeline(file, branchId);
  const s = emptyStats();
  for (const t of chain) accumulate(s, t);
  return s;
}

/**
 * Roll up per-turn metadata for EVERY turn in the session, regardless of
 * branch. Turn IDs are unique across branches (they're content-addressed),
 * so iterating file.turns directly avoids double-counting shared ancestors.
 */
export function computeSessionStats(file: SessionFile): Stats {
  const s = emptyStats();
  for (const t of Object.values(file.turns)) accumulate(s, t);
  return s;
}
