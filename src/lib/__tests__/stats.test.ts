import { describe, it, expect } from "vitest";

import type { Branch, SessionFile, Turn } from "../ipc";
import { computeBranchStats, computeSessionStats } from "../stats";

function mkTurn(
  id: string,
  parent: string | null,
  role: Turn["role"],
  content: string,
  meta?: Partial<NonNullable<Turn["generated_by"]>["response_meta"]>,
): Turn {
  return {
    id,
    parent,
    role,
    content,
    created_at: "2026-04-17T00:00:00Z",
    generated_by: meta
      ? {
          endpoint: "",
          model: "",
          options: {},
          request_body: {},
          response_meta: meta,
        }
      : undefined,
  };
}

function mkSession(turns: Turn[], branches: Record<string, Branch>): SessionFile {
  const byId: Record<string, Turn> = {};
  for (const t of turns) byId[t.id] = t;
  return {
    loom_schema: 1,
    session: {
      id: "sess_01",
      title: "t",
      created_at: "2026-04-17T00:00:00Z",
      model: "test",
      default_options: {},
      default_endpoint: "",
    },
    turns: byId,
    branches,
    head_branch: Object.keys(branches)[0] ?? "b0",
  };
}

describe("computeBranchStats", () => {
  it("returns zeroed stats for empty branch", () => {
    const file = mkSession(
      [],
      {
        b0: { name: "main", head: "missing", created_at: "" },
      },
    );
    const s = computeBranchStats(file, "b0");
    expect(s.turn_count).toBe(0);
    expect(s.total_cost_usd).toBe(0);
  });

  it("sums tokens/cost/duration over a linear chain", () => {
    const turns = [
      mkTurn("t0", null, "system", "sys"),
      mkTurn("t1", "t0", "user", "hi"),
      mkTurn("t2", "t1", "assistant", "hello", {
        prompt_eval_count: 10,
        eval_count: 5,
        cached_tokens: 2,
        cost_usd: 0.0015,
        total_duration_ns: 200_000_000, // 200 ms
      }),
      mkTurn("t3", "t2", "user", "next"),
      mkTurn("t4", "t3", "assistant", "ok", {
        prompt_eval_count: 20,
        eval_count: 3,
        cost_usd: 0.002,
        total_duration_ns: 100_000_000, // 100 ms
      }),
    ];
    const file = mkSession(turns, {
      b0: { name: "main", head: "t4", created_at: "" },
    });
    const s = computeBranchStats(file, "b0");
    expect(s.turn_count).toBe(5);
    expect(s.total_input_tokens).toBe(30);
    expect(s.total_output_tokens).toBe(8);
    expect(s.total_cached_tokens).toBe(2);
    expect(s.total_cost_usd).toBeCloseTo(0.0035, 6);
    expect(s.total_duration_ms).toBe(300);
  });

  it("ignores turns with no generated_by meta", () => {
    const turns = [
      mkTurn("t0", null, "user", "hi"),
      mkTurn("t1", "t0", "assistant", "hello"), // no meta
    ];
    const file = mkSession(turns, {
      b0: { name: "main", head: "t1", created_at: "" },
    });
    const s = computeBranchStats(file, "b0");
    expect(s.turn_count).toBe(2);
    expect(s.total_input_tokens).toBe(0);
    expect(s.total_cost_usd).toBe(0);
  });

  it("handles missing branch id gracefully (empty stats)", () => {
    const file = mkSession(
      [mkTurn("t0", null, "user", "hi")],
      { b0: { name: "main", head: "t0", created_at: "" } },
    );
    const s = computeBranchStats(file, "bogus-id");
    expect(s.turn_count).toBe(0);
  });
});

describe("computeSessionStats", () => {
  it("aggregates every turn in the session regardless of branch", () => {
    // b0: t0 → t1 → t2 (3 turns)
    // b1: fork at t1 → t3 → t4 (b1 has t0, t1, t3, t4 = 4 turns in its chain
    //     but session-wide we have 5 unique turns)
    const turns = [
      mkTurn("t0", null, "system", "sys", {
        prompt_eval_count: 1,
      }),
      mkTurn("t1", "t0", "user", "a", {
        prompt_eval_count: 1,
      }),
      mkTurn("t2", "t1", "assistant", "b", {
        prompt_eval_count: 1,
        eval_count: 10,
        cost_usd: 0.001,
      }),
      mkTurn("t3", "t1", "user", "c", {
        prompt_eval_count: 1,
      }),
      mkTurn("t4", "t3", "assistant", "d", {
        prompt_eval_count: 1,
        eval_count: 20,
        cost_usd: 0.002,
      }),
    ];
    const file = mkSession(turns, {
      b0: { name: "main", head: "t2", created_at: "" },
      b1: { name: "fork", head: "t4", created_at: "", parent_branch: "b0", forked_at: "t1" },
    });

    const session = computeSessionStats(file);
    // Session sums ALL 5 turns — not the union of branch chains.
    expect(session.turn_count).toBe(5);
    expect(session.total_input_tokens).toBe(5);
    expect(session.total_output_tokens).toBe(30);
    expect(session.total_cost_usd).toBeCloseTo(0.003, 6);
  });
});
