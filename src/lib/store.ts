import { create } from "zustand";

import {
  branchCheckout,
  branchForkFromEdit,
  buildContextMessages,
  listModels,
  ollamaChat,
  sessionCreate,
  sessionDelete,
  sessionList,
  sessionOpen,
  sessionSave,
  sessionSetContextLimit,
  turnAppend,
  turnPin,
  type ChatOptions,
  type GeneratedBy,
  type Message,
  type ModelInfo,
  type SessionFile,
  type SessionSummary,
  type TokenLogprob,
  type Turn,
} from "./ipc";

type SendError = { message: string } | null;

export type SweepMode = "seed" | "temperature";

export interface SweepRun {
  id: string;
  seed: number;
  temperature: number;
  status: "pending" | "streaming" | "done" | "error";
  content: string;
  eval_count?: number;
  error?: string;
}

export interface SweepState {
  sourceTurnId: string;
  mode: SweepMode;
  runs: SweepRun[];
}

interface LoomStore {
  // Catalog
  models: ModelInfo[];
  modelsError: string | null;
  sessions: SessionSummary[];

  // Open session
  current: SessionFile | null;

  // Streaming
  streaming: boolean;
  streamingContent: string;
  streamingStartedAt: number | null;
  sendError: SendError;

  // Composer-adjacent state
  seedDraft: string;
  setSeedDraft: (v: string) => void;
  logprobsEnabled: boolean;
  setLogprobsEnabled: (v: boolean) => void;

  // Variance sweep
  sweep: SweepState | null;
  startSweep: (
    turnId: string,
    opts: { n: number; mode: SweepMode; baseOptions: ChatOptions },
  ) => Promise<void>;
  commitSweep: () => Promise<void>;
  discardSweep: () => void;

  // Actions
  refresh: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  closeSession: () => void;
  createSession: (
    title: string,
    model: string,
    systemPrompt?: string,
  ) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string, options: ChatOptions) => Promise<void>;
  forkFromEdit: (
    turnId: string,
    newContent: string,
    opts: { regenerate: boolean; options?: ChatOptions },
  ) => Promise<void>;
  checkoutBranch: (branchId: string) => Promise<void>;
  regenerateHead: (options: ChatOptions) => Promise<void>;
  renameSession: (title: string) => Promise<void>;
  pinTurn: (turnId: string, pinned: boolean) => Promise<void>;
  setContextLimit: (limit: number | null) => Promise<void>;
}

export const useLoom = create<LoomStore>((set, get) => ({
  models: [],
  modelsError: null,
  sessions: [],
  current: null,
  streaming: false,
  streamingContent: "",
  streamingStartedAt: null,
  sendError: null,
  seedDraft: "",
  setSeedDraft: (v) => set({ seedDraft: v }),
  logprobsEnabled: false,
  setLogprobsEnabled: (v) => set({ logprobsEnabled: v }),
  sweep: null,

  async refresh() {
    const [sessions, models] = await Promise.all([
      sessionList().catch(() => [] as SessionSummary[]),
      listModels().catch((e) => {
        set({ modelsError: String(e) });
        return [] as ModelInfo[];
      }),
    ]);
    set({ sessions, models, modelsError: models.length > 0 ? null : get().modelsError });
  },

  async openSession(id) {
    const file = await sessionOpen(id);
    set({
      current: file,
      streamingContent: "",
      sendError: null,
      seedDraft: file.session.default_seed?.toString() ?? "",
    });
  },

  closeSession() {
    set({ current: null, streamingContent: "", sendError: null });
  },

  async createSession(title, model, systemPrompt) {
    const file = await sessionCreate(title, model, systemPrompt);
    set({
      current: file,
      streamingContent: "",
      sendError: null,
      seedDraft: file.session.default_seed?.toString() ?? "",
    });
    await get().refresh();
  },

  async deleteSession(id) {
    await sessionDelete(id);
    const { current } = get();
    if (current && current.session.id === id) set({ current: null });
    await get().refresh();
  },

  async sendMessage(content, options) {
    const { current } = get();
    if (!current) return;
    if (!content.trim()) return;

    const afterUser = await turnAppend(
      current.session.id,
      current.head_branch,
      "user",
      content,
    );
    set({ current: afterUser });
    await streamAssistantReply(afterUser, options, set, get);
  },

  async forkFromEdit(turnId, newContent, opts) {
    const { current } = get();
    if (!current) return;
    try {
      const afterFork = await branchForkFromEdit(current.session.id, turnId, newContent);
      set({ current: afterFork, sendError: null });
      await get().refresh();
      if (opts.regenerate) {
        await streamAssistantReply(afterFork, opts.options ?? {}, set, get);
      }
    } catch (e) {
      set({ sendError: { message: String(e) } });
    }
  },

  async checkoutBranch(branchId) {
    const { current } = get();
    if (!current) return;
    const after = await branchCheckout(current.session.id, branchId);
    set({ current: after });
  },

  async regenerateHead(options) {
    const { current } = get();
    if (!current) return;
    await streamAssistantReply(current, options, set, get);
  },

  async renameSession(title) {
    const { current } = get();
    if (!current) return;
    const updated: SessionFile = {
      ...current,
      session: { ...current.session, title },
    };
    await sessionSave(updated);
    set({ current: updated });
    await get().refresh();
  },

  async pinTurn(turnId, pinned) {
    const { current } = get();
    if (!current) return;
    const updated = await turnPin(current.session.id, turnId, pinned);
    set({ current: updated });
  },

  async setContextLimit(limit) {
    const { current } = get();
    if (!current) return;
    const updated = await sessionSetContextLimit(current.session.id, limit);
    set({ current: updated });
  },

  async startSweep(turnId, { n, mode, baseOptions }) {
    const { current } = get();
    if (!current) return;

    const chain = chainEndingAt(current, turnId);
    if (chain.length < 2) return; // need at least system + parent
    // Strip the source turn itself (T); keep its parent chain.
    const contextTurns = chain.slice(0, -1);
    const messages: Message[] = contextTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    const runs: SweepRun[] = Array.from({ length: n }, (_, i) => ({
      id: `sweep_${Date.now()}_${i}`,
      seed:
        mode === "seed"
          ? Math.floor(Math.random() * 0x7fffffff)
          : baseOptions.seed ?? 0,
      temperature:
        mode === "temperature"
          ? lerp(0.2, 1.2, n === 1 ? 0.5 : i / (n - 1))
          : baseOptions.temperature ?? 0.7,
      status: "pending",
      content: "",
    }));

    set({ sweep: { sourceTurnId: turnId, mode, runs } });

    await Promise.all(
      runs.map(async (run) => {
        updateSweepRun(set, get, run.id, { status: "streaming" });
        try {
          await ollamaChat(
            {
              model: current.session.model,
              messages,
              stream: true,
              options: {
                ...baseOptions,
                seed: run.seed,
                temperature: run.temperature,
              },
            },
            (ev) => {
              if (ev.kind === "delta") {
                const cur = pickSweepRun(get, run.id);
                if (!cur) return;
                updateSweepRun(set, get, run.id, {
                  content: cur.content + ev.content,
                });
              } else if (ev.kind === "done") {
                updateSweepRun(set, get, run.id, {
                  status: "done",
                  eval_count: ev.eval_count ?? undefined,
                });
              } else if (ev.kind === "error") {
                updateSweepRun(set, get, run.id, {
                  status: "error",
                  error: ev.message,
                });
              }
            },
          );
        } catch (e) {
          updateSweepRun(set, get, run.id, {
            status: "error",
            error: String(e),
          });
        }
      }),
    );
  },

  async commitSweep() {
    const { sweep, current } = get();
    if (!sweep || !current) return;
    for (const run of sweep.runs) {
      if (run.status !== "done" || !run.content.trim()) continue;
      try {
        const after = await branchForkFromEdit(
          current.session.id,
          sweep.sourceTurnId,
          run.content,
        );
        set({ current: after });
      } catch (e) {
        console.error("commitSweep: fork failed", e);
      }
    }
    set({ sweep: null });
    await get().refresh();
  },

  discardSweep() {
    set({ sweep: null });
  },
}));

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function chainEndingAt(file: SessionFile, turnId: string): Turn[] {
  const chain: Turn[] = [];
  let cur: string | null = turnId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const t: Turn | undefined = file.turns[cur];
    if (!t) break;
    chain.push(t);
    cur = t.parent;
  }
  return chain.reverse();
}

function pickSweepRun(get: Getter, runId: string): SweepRun | undefined {
  return get().sweep?.runs.find((r) => r.id === runId);
}

function updateSweepRun(
  set: Setter,
  get: Getter,
  runId: string,
  patch: Partial<SweepRun>,
) {
  const sweep = get().sweep;
  if (!sweep) return;
  set({
    sweep: {
      ...sweep,
      runs: sweep.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)),
    },
  });
}

// ───────────────────────────── internals ─────────────────────────────

type Setter = (
  s:
    | Partial<LoomStore>
    | ((s: LoomStore) => Partial<LoomStore> | LoomStore),
) => void;
type Getter = () => LoomStore;

async function streamAssistantReply(
  file: SessionFile,
  options: ChatOptions,
  set: Setter,
  get: Getter,
): Promise<void> {
  set({
    streaming: true,
    streamingContent: "",
    streamingStartedAt: Date.now(),
    sendError: null,
  });

  try {
    const { included } = buildContextMessages(file);
    const messages: Message[] = included.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    const logprobsEnabled = get().logprobsEnabled;

    let assistantText = "";
    let responseMeta: GeneratedBy["response_meta"] = {};
    const accumulatedLogprobs: TokenLogprob[] = [];

    await ollamaChat(
      {
        model: file.session.model,
        messages,
        stream: true,
        options,
        ...(logprobsEnabled ? { logprobs: true, top_logprobs: 5 } : {}),
      },
      (ev) => {
        if (ev.kind === "delta") {
          assistantText += ev.content;
          if (ev.logprobs) accumulatedLogprobs.push(...ev.logprobs);
          set({ streamingContent: assistantText });
        } else if (ev.kind === "done") {
          responseMeta = {
            prompt_eval_count: ev.prompt_eval_count ?? undefined,
            eval_count: ev.eval_count ?? undefined,
            prompt_eval_duration_ns: ev.prompt_eval_duration_ns ?? undefined,
            eval_duration_ns: ev.eval_duration_ns ?? undefined,
            total_duration_ns: ev.total_duration_ns ?? undefined,
          };
        } else if (ev.kind === "error") {
          set({ sendError: { message: ev.message } });
        }
      },
    );

    const generated_by: GeneratedBy = {
      endpoint: file.session.default_endpoint,
      model: file.session.model,
      options,
      request_body: { model: file.session.model, messages, options },
      response_meta: responseMeta,
    };
    const afterAsst = await turnAppend(
      file.session.id,
      file.head_branch,
      "assistant",
      assistantText,
      generated_by,
      accumulatedLogprobs.length > 0 ? accumulatedLogprobs : undefined,
    );
    set({ current: afterAsst });
  } catch (e) {
    set({ sendError: { message: String(e) } });
  } finally {
    set({ streaming: false, streamingContent: "", streamingStartedAt: null });
    await get().refresh();
  }
}

