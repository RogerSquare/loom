import { create } from "zustand";

import {
  buildTimeline,
  listModels,
  ollamaChat,
  sessionCreate,
  sessionDelete,
  sessionList,
  sessionOpen,
  turnAppend,
  type ChatOptions,
  type GeneratedBy,
  type Message,
  type ModelInfo,
  type SessionFile,
  type SessionSummary,
  type Turn,
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
    set({ current: file, streamingContent: "", sendError: null });
  },

  closeSession() {
    set({ current: null, streamingContent: "", sendError: null });
  },

  async createSession(title, model, systemPrompt) {
    const file = await sessionCreate(title, model, systemPrompt);
    set({ current: file, streamingContent: "", sendError: null });
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

    set({ streaming: true, streamingContent: "", streamingStartedAt: Date.now(), sendError: null });

    try {
      // 1. Persist the user turn first.
      const afterUser = await turnAppend(
        current.session.id,
        current.head_branch,
        "user",
        content,
      );
      set({ current: afterUser });

      // 2. Build the message chain to send to Ollama.
      const timeline = buildTimeline(afterUser);
      const messages: Message[] = timeline.map((t) => ({
        role: t.role,
        content: t.content,
      }));

      // 3. Stream assistant reply; accumulate into `streamingContent`.
      let assistantText = "";
      let responseMeta: GeneratedBy["response_meta"] = {};

      await ollamaChat(
        {
          model: afterUser.session.model,
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

      // 4. Persist assistant turn.
      const generated_by: GeneratedBy = {
        endpoint: afterUser.session.default_endpoint,
        model: afterUser.session.model,
        options,
        request_body: { model: afterUser.session.model, messages, options },
        response_meta: responseMeta,
      };
      const afterAsst = await turnAppend(
        afterUser.session.id,
        afterUser.head_branch,
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
  },
}));

export const selectTimeline = (s: LoomStore): Turn[] =>
  s.current ? buildTimeline(s.current) : [];
