import { describe, it, expect } from "vitest";

import {
  buildTimeline,
  buildContextMessages,
  findSiblings,
  exportAsCurl,
  type SessionFile,
  type Turn,
  type Branch,
} from "../ipc";

// ───────────────── Test fixtures ─────────────────

function mkTurn(
  id: string,
  parent: string | null,
  role: Turn["role"],
  content: string,
  opts?: Partial<Turn>,
): Turn {
  return {
    id,
    parent,
    role,
    content,
    created_at: "2026-04-17T12:00:00Z",
    ...opts,
  };
}

function mkBranch(name: string, head: string): Branch {
  return {
    name,
    head,
    created_at: "2026-04-17T12:00:00Z",
  };
}

function mkFile(
  turns: Record<string, Turn>,
  branches: Record<string, Branch>,
  headBranch: string,
  contextLimit?: number,
): SessionFile {
  return {
    loom_schema: 1,
    session: {
      id: "sess_test",
      title: "test",
      created_at: "2026-04-17T12:00:00Z",
      model: "llama3.1:8b",
      default_options: {},
      default_endpoint: "http://localhost:11434/api/chat",
      context_limit: contextLimit,
    },
    turns,
    branches,
    head_branch: headBranch,
  };
}

// ───────────────── buildTimeline ─────────────────

describe("buildTimeline", () => {
  it("returns root-to-head chain in order", () => {
    const file = mkFile(
      {
        t1: mkTurn("t1", null, "system", "sys"),
        t2: mkTurn("t2", "t1", "user", "hi"),
        t3: mkTurn("t3", "t2", "assistant", "hello"),
      },
      { b_main: mkBranch("main", "t3") },
      "b_main",
    );
    const chain = buildTimeline(file);
    expect(chain.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("returns empty array for missing branch", () => {
    const file = mkFile({}, { b_main: mkBranch("main", "t_nope") }, "b_main");
    expect(buildTimeline(file)).toEqual([]);
  });

  it("handles single-turn session", () => {
    const file = mkFile(
      { t1: mkTurn("t1", null, "system", "sys") },
      { b_main: mkBranch("main", "t1") },
      "b_main",
    );
    expect(buildTimeline(file).map((t) => t.id)).toEqual(["t1"]);
  });
});

// ───────────────── buildContextMessages ─────────────────

describe("buildContextMessages", () => {
  const baseTurns = {
    t1: mkTurn("t1", null, "system", "sys"),
    t2: mkTurn("t2", "t1", "user", "q1"),
    t3: mkTurn("t3", "t2", "assistant", "a1"),
    t4: mkTurn("t4", "t3", "user", "q2"),
    t5: mkTurn("t5", "t4", "assistant", "a2"),
    t6: mkTurn("t6", "t5", "user", "q3"),
    t7: mkTurn("t7", "t6", "assistant", "a3"),
  };

  it("returns all turns when no limit", () => {
    const file = mkFile(
      baseTurns,
      { b_main: mkBranch("main", "t7") },
      "b_main",
    );
    const { included, excluded } = buildContextMessages(file);
    expect(included).toHaveLength(7);
    expect(excluded.size).toBe(0);
  });

  it("keeps root + last N when limit is set", () => {
    const file = mkFile(
      baseTurns,
      { b_main: mkBranch("main", "t7") },
      "b_main",
      2,
    );
    const { included, excluded } = buildContextMessages(file);
    // root (t1) always included + last 2 non-pinned (t6, t7)
    expect(included.map((t) => t.id)).toEqual(["t1", "t6", "t7"]);
    expect(excluded.size).toBe(4); // t2, t3, t4, t5
  });

  it("always includes pinned turns regardless of limit", () => {
    const turns = {
      ...baseTurns,
      t3: mkTurn("t3", "t2", "assistant", "a1", { pinned: true }),
    };
    const file = mkFile(
      turns,
      { b_main: mkBranch("main", "t7") },
      "b_main",
      2,
    );
    const { included } = buildContextMessages(file);
    // root (t1) + pinned (t3) + last 2 non-pinned (t6, t7)
    expect(included.map((t) => t.id)).toEqual(["t1", "t3", "t6", "t7"]);
  });

  it("includes all when all are pinned", () => {
    const turns: Record<string, Turn> = {};
    for (const [k, v] of Object.entries(baseTurns)) {
      turns[k] = { ...v, pinned: true };
    }
    const file = mkFile(
      turns,
      { b_main: mkBranch("main", "t7") },
      "b_main",
      1,
    );
    const { included } = buildContextMessages(file);
    // root + 6 pinned = 7 total; limit=1 but all pinned → all included
    expect(included).toHaveLength(7);
  });

  it("root is always included even with limit=0", () => {
    const file = mkFile(
      baseTurns,
      { b_main: mkBranch("main", "t7") },
      "b_main",
      0,
    );
    const { included } = buildContextMessages(file);
    // Only root survives
    expect(included.map((t) => t.id)).toEqual(["t1"]);
  });
});

// ───────────────── findSiblings ─────────────────

describe("findSiblings", () => {
  it("returns sibling turns with same parent", () => {
    const file = mkFile(
      {
        t1: mkTurn("t1", null, "system", "sys"),
        t2: mkTurn("t2", "t1", "user", "original"),
        t3: mkTurn("t3", "t1", "user", "edited"),
      },
      { b_main: mkBranch("main", "t2") },
      "b_main",
    );
    const siblings = findSiblings(file, "t2");
    expect(siblings.map((s) => s.id)).toEqual(["t3"]);
  });

  it("returns empty when no siblings", () => {
    const file = mkFile(
      {
        t1: mkTurn("t1", null, "system", "sys"),
        t2: mkTurn("t2", "t1", "user", "only child"),
      },
      { b_main: mkBranch("main", "t2") },
      "b_main",
    );
    expect(findSiblings(file, "t2")).toEqual([]);
  });

  it("returns empty for non-existent turn", () => {
    const file = mkFile(
      { t1: mkTurn("t1", null, "system", "sys") },
      { b_main: mkBranch("main", "t1") },
      "b_main",
    );
    expect(findSiblings(file, "t_nope")).toEqual([]);
  });

  it("handles multiple siblings", () => {
    const file = mkFile(
      {
        t1: mkTurn("t1", null, "system", "sys"),
        t2: mkTurn("t2", "t1", "assistant", "v1"),
        t3: mkTurn("t3", "t1", "assistant", "v2"),
        t4: mkTurn("t4", "t1", "assistant", "v3"),
      },
      { b_main: mkBranch("main", "t2") },
      "b_main",
    );
    const siblings = findSiblings(file, "t2");
    expect(siblings).toHaveLength(2);
  });
});

// ───────────────── exportAsCurl ─────────────────

describe("exportAsCurl", () => {
  it("generates valid bash script with shebang", () => {
    const file = mkFile(
      {
        t1: mkTurn("t1", null, "system", "sys"),
        t2: mkTurn("t2", "t1", "user", "hello"),
      },
      { b_main: mkBranch("main", "t2") },
      "b_main",
    );
    const script = exportAsCurl(file);
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("curl -s");
    expect(script).toContain("llama3.1:8b");
    expect(script).toContain("hello");
  });

  it("includes session title in comment", () => {
    const file = mkFile(
      { t1: mkTurn("t1", null, "system", "sys") },
      { b_main: mkBranch("main", "t1") },
      "b_main",
    );
    const script = exportAsCurl(file);
    expect(script).toContain("# Loom session: test");
  });
});
