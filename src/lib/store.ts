import { create } from "zustand";

import {
  branchCheckout,
  branchFork,
  branchForkFromEdit,
  buildContextMessages,
  garakCancel,
  garakScan,
  turnAnnotate,
  listModels,
  ollamaChat,
  ollamaContinueFromPrefill,
  sessionCreate,
  sessionDelete,
  sessionList,
  sessionOpen,
  sessionSave,
  sessionSetContextLimit,
  sessionSetModel,
  sessionSetTags,
  turnAppend,
  turnPin,
  type ChatOptions,
  type GarakEvent,
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

type GarakLine = { stream: "out" | "err"; text: string };

export interface GarakState {
  running: boolean;
  lines: GarakLine[];
  reportPath: string | null;
  exitCode: number | null;
  error: string | null;
}

interface LoomStore {
  // Catalog
  models: ModelInfo[];
  modelsError: string | null;
  modelsLoading: boolean;
  sessions: SessionSummary[];
  sessionsLoading: boolean;

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
  outputFormat: "none" | "json" | "schema";
  outputSchema: string;
  setOutputFormat: (v: "none" | "json" | "schema") => void;
  setOutputSchema: (v: string) => void;
  rawJsonMode: boolean;
  setRawJsonMode: (v: boolean) => void;
  sendRawJson: (jsonStr: string) => Promise<void>;

  // Variance sweep
  sweep: SweepState | null;

  // Garak scan (persists across modal open/close)
  garak: GarakState;
  startGarak: (probes: string, generations: number) => Promise<void>;
  cancelGarak: () => Promise<void>;
  clearGarak: () => void;
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
  rerunWithParams: (
    assistantTurnId: string,
    options: ChatOptions,
  ) => Promise<void>;
  continueFromPrefill: (
    turnId: string,
    prefillText: string,
    options?: ChatOptions,
  ) => Promise<void>;
  checkoutBranch: (branchId: string) => Promise<void>;
  regenerateHead: (options: ChatOptions) => Promise<void>;
  renameSession: (title: string) => Promise<void>;
  pinTurn: (turnId: string, pinned: boolean) => Promise<void>;
  annotateTurn: (turnId: string, annotations: string[]) => Promise<void>;
  setContextLimit: (limit: number | null) => Promise<void>;
  setSessionTags: (tags: string[]) => Promise<void>;
  setSessionModel: (model: string) => Promise<void>;
}

export const useLoom = create<LoomStore>((set, get) => ({
  models: [],
  modelsError: null,
  modelsLoading: true,
  sessions: [],
  sessionsLoading: true,
  current: null,
  streaming: false,
  streamingContent: "",
  streamingStartedAt: null,
  sendError: null,
  seedDraft: "",
  setSeedDraft: (v) => set({ seedDraft: v }),
  logprobsEnabled: false,
  setLogprobsEnabled: (v) => set({ logprobsEnabled: v }),
  outputFormat: "none",
  outputSchema: "",
  setOutputFormat: (v) => set({ outputFormat: v }),
  setOutputSchema: (v) => set({ outputSchema: v }),
  rawJsonMode: false,
  setRawJsonMode: (v) => set({ rawJsonMode: v }),
  sweep: null,
  garak: {
    running: false,
    lines: [],
    reportPath: null,
    exitCode: null,
    error: null,
  },

  async refresh() {
    set({ sessionsLoading: true, modelsLoading: true });
    const [sessions, models] = await Promise.all([
      sessionList().catch(() => [] as SessionSummary[]),
      listModels().catch((e) => {
        set({ modelsError: String(e) });
        return [] as ModelInfo[];
      }),
    ]);
    set({
      sessions,
      models,
      modelsError: models.length > 0 ? null : get().modelsError,
      sessionsLoading: false,
      modelsLoading: false,
    });
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

  async sendRawJson(jsonStr) {
    const { current } = get();
    if (!current) return;
    if (get().streaming) {
      set({ sendError: { message: "another stream is already running" } });
      return;
    }

    let req;
    try {
      req = JSON.parse(jsonStr);
    } catch (e) {
      set({ sendError: { message: `invalid JSON: ${e}` } });
      return;
    }

    set({
      streaming: true,
      streamingContent: "",
      streamingStartedAt: Date.now(),
      sendError: null,
    });

    try {
      let assistantText = "";
      let responseMeta: GeneratedBy["response_meta"] = {};

      await ollamaChat(req, (ev) => {
        if (ev.kind === "delta") {
          assistantText += ev.content;
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
      });

      const generated_by: GeneratedBy = {
        endpoint: current.session.default_endpoint,
        model: req.model ?? current.session.model,
        options: req.options ?? {},
        request_body: req,
        response_meta: responseMeta,
      };
      const afterAsst = await turnAppend(
        current.session.id,
        current.head_branch,
        "assistant",
        assistantText,
        generated_by,
      );
      set({ current: afterAsst });
    } catch (e) {
      set({ sendError: { message: String(e) } });
    } finally {
      set({ streaming: false, streamingContent: "", streamingStartedAt: null });
    }
  },

  async rerunWithParams(assistantTurnId, options) {
    const { current } = get();
    if (!current) return;
    const turn: Turn | undefined = current.turns[assistantTurnId];
    if (!turn || !turn.parent) return;

    try {
      const afterFork = await branchFork(
        current.session.id,
        turn.parent,
        `rerun-${Date.now().toString(36)}`,
      );
      const oldIds = new Set(Object.keys(current.branches));
      const newBranchId = Object.keys(afterFork.branches).find(
        (b) => !oldIds.has(b),
      );
      if (!newBranchId) return;

      const afterCheckout = await branchCheckout(
        afterFork.session.id,
        newBranchId,
      );
      set({ current: afterCheckout });
      await streamAssistantReply(afterCheckout, options, set, get);
    } catch (e) {
      set({ sendError: { message: String(e) } });
    }
  },

  async forkFromEdit(turnId, newContent, opts) {
    const { current } = get();
    if (!current) return;
    try {
      const afterFork = await branchForkFromEdit(current.session.id, turnId, newContent);
      set({ current: afterFork, sendError: null });
      if (opts.regenerate) {
        await streamAssistantReply(afterFork, opts.options ?? {}, set, get);
      }
    } catch (e) {
      set({ sendError: { message: String(e) } });
    }
  },

  async continueFromPrefill(turnId, prefillText, options) {
    const { current } = get();
    if (!current) return;
    if (get().streaming) {
      set({ sendError: { message: "another stream is already running" } });
      return;
    }

    // Build context up to the edited turn's PARENT (the preceding user turn).
    const chain = chainEndingAt(current, turnId);
    if (chain.length < 1) return;
    const contextTurns = chain.slice(0, -1);
    const messages: Message[] = contextTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));

    set({
      streaming: true,
      streamingContent: prefillText,
      streamingStartedAt: Date.now(),
      sendError: null,
    });

    try {
      let generated = "";
      const opts = options ?? { temperature: 0.7, top_p: 0.9, num_ctx: 8192 };

      await ollamaContinueFromPrefill(
        current.session.model,
        messages,
        prefillText,
        opts,
        (ev) => {
          if (ev.kind === "delta") {
            generated += ev.content;
            set({ streamingContent: prefillText + generated });
          } else if (ev.kind === "error") {
            set({ sendError: { message: ev.message } });
          }
          // 'done' consumed implicitly on promise resolution.
        },
      );

      const fullContent = prefillText + generated;
      const afterFork = await branchForkFromEdit(
        current.session.id,
        turnId,
        fullContent,
      );
      set({ current: afterFork, sendError: null });
    } catch (e) {
      set({ sendError: { message: String(e) } });
    } finally {
      set({ streaming: false, streamingContent: "", streamingStartedAt: null });
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

  async annotateTurn(turnId, annotations) {
    const { current } = get();
    if (!current) return;
    const updated = await turnAnnotate(current.session.id, turnId, annotations);
    set({ current: updated });
  },

  async setContextLimit(limit) {
    const { current } = get();
    if (!current) return;
    const updated = await sessionSetContextLimit(current.session.id, limit);
    set({ current: updated });
  },

  async setSessionTags(tags) {
    const { current } = get();
    if (!current) return;
    const updated = await sessionSetTags(current.session.id, tags);
    set({ current: updated });
    await get().refresh();
  },

  async setSessionModel(model) {
    const { current } = get();
    if (!current) return;
    const updated = await sessionSetModel(current.session.id, model);
    set({ current: updated });
    await get().refresh();
  },

  async startGarak(probes, generations) {
    const { current } = get();
    if (!current) return;
    set({
      garak: {
        running: true,
        lines: [],
        reportPath: null,
        exitCode: null,
        error: null,
      },
    });
    try {
      await garakScan(current.session.model, probes, generations, (ev: GarakEvent) => {
        const g = get().garak;
        if (ev.kind === "stdout") {
          set({ garak: { ...g, lines: [...g.lines, { stream: "out", text: ev.line }] } });
        } else if (ev.kind === "stderr") {
          set({ garak: { ...g, lines: [...g.lines, { stream: "err", text: ev.line }] } });
        } else if (ev.kind === "done") {
          set({
            garak: {
              ...g,
              running: false,
              exitCode: ev.exit_code,
              reportPath: ev.report_path,
            },
          });
        } else if (ev.kind === "error") {
          set({ garak: { ...g, running: false, error: ev.message } });
        }
      });
    } catch (e) {
      const g = get().garak;
      set({ garak: { ...g, running: false, error: String(e) } });
    }
  },

  async cancelGarak() {
    await garakCancel();
    const g = get().garak;
    set({ garak: { ...g, running: false, error: "cancelled by user" } });
  },

  clearGarak() {
    set({
      garak: {
        running: false,
        lines: [],
        reportPath: null,
        exitCode: null,
        error: null,
      },
    });
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
        updateSweepRun(set, run.id, { status: "streaming" });
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
                // Use functional updater to safely append content
                set((state) => {
                  if (!state.sweep) return {};
                  return {
                    sweep: {
                      ...state.sweep,
                      runs: state.sweep.runs.map((r) =>
                        r.id === run.id
                          ? { ...r, content: r.content + ev.content }
                          : r,
                      ),
                    },
                  };
                });
              } else if (ev.kind === "done") {
                updateSweepRun(set, run.id, {
                  status: "done",
                  eval_count: ev.eval_count ?? undefined,
                });
              } else if (ev.kind === "error") {
                updateSweepRun(set, run.id, {
                  status: "error",
                  error: ev.message,
                });
              }
            },
          );
        } catch (e) {
          updateSweepRun(set, run.id, {
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

/** Atomic sweep-run updater — uses functional set() to avoid lost updates
 * when multiple parallel promises call this concurrently. */
function updateSweepRun(
  set: Setter,
  runId: string,
  patch: Partial<SweepRun>,
) {
  set((state) => {
    if (!state.sweep) return {};
    return {
      sweep: {
        ...state.sweep,
        runs: state.sweep.runs.map((r) =>
          r.id === runId ? { ...r, ...patch } : r,
        ),
      },
    };
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
  if (get().streaming) {
    set({ sendError: { message: "another stream is already running — wait for it to finish" } });
    return;
  }
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
    const outputFormat = get().outputFormat;
    const outputSchema = get().outputSchema;

    let formatParam: unknown = undefined;
    if (outputFormat === "json") {
      formatParam = "json";
    } else if (outputFormat === "schema" && outputSchema.trim()) {
      try {
        formatParam = JSON.parse(outputSchema);
      } catch {
        formatParam = "json";
      }
    }

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
        ...(formatParam !== undefined ? { format: formatParam } : {}),
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
  }
}

