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
} from "./ipc";

type SendError = { message: string } | null;

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
}));

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

    let assistantText = "";
    let responseMeta: GeneratedBy["response_meta"] = {};

    await ollamaChat(
      {
        model: file.session.model,
        messages,
        stream: true,
        options,
      },
      (ev) => {
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
    );
    set({ current: afterAsst });
  } catch (e) {
    set({ sendError: { message: String(e) } });
  } finally {
    set({ streaming: false, streamingContent: "", streamingStartedAt: null });
    await get().refresh();
  }
}

