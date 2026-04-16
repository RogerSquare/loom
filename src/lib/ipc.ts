import { Channel, invoke } from "@tauri-apps/api/core";

// ───────────────────────────── Types ─────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  images?: string[];
}

export interface ChatOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
  num_predict?: number;
  seed?: number;
  stop?: string[];
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  options?: ChatOptions;
  format?: unknown;
  keep_alive?: string;
}

export type StreamEvent =
  | { kind: "delta"; content: string }
  | {
      kind: "done";
      prompt_eval_count: number | null;
      eval_count: number | null;
      prompt_eval_duration_ns: number | null;
      eval_duration_ns: number | null;
      total_duration_ns: number | null;
    }
  | { kind: "error"; message: string };

export interface ModelInfo {
  name: string;
  model: string;
  size: number;
  modified_at: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

// Session schema — mirrors Rust store::schema.

export interface ResponseMeta {
  prompt_eval_count?: number;
  eval_count?: number;
  prompt_eval_duration_ns?: number;
  eval_duration_ns?: number;
  total_duration_ns?: number;
}

export interface GeneratedBy {
  endpoint: string;
  model: string;
  options: ChatOptions;
  request_body: unknown;
  response_meta: ResponseMeta;
}

export interface Turn {
  id: string;
  parent: string | null;
  role: Role;
  content: string;
  created_at: string;
  generated_by?: GeneratedBy;
  annotations?: string[];
  swipe_group?: string;
}

export interface Branch {
  name: string;
  head: string;
  created_at: string;
  parent_branch?: string;
  forked_at?: string;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  model: string;
  default_options: ChatOptions;
  default_endpoint: string;
}

export interface SessionFile {
  loom_schema: number;
  session: Session;
  turns: Record<string, Turn>;
  branches: Record<string, Branch>;
  head_branch: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  created_at: string;
  model: string;
  turn_count: number;
  branch_count: number;
}

// ───────────────────────────── Ollama ─────────────────────────────

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("ollama_list_models");
}

export async function ollamaChat(
  req: ChatRequest,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  await invoke("ollama_chat", { req, onChunk: channel });
}

// ───────────────────────────── Session ─────────────────────────────

export const sessionList = (): Promise<SessionSummary[]> =>
  invoke("session_list");

export const sessionOpen = (id: string): Promise<SessionFile> =>
  invoke("session_open", { id });

export const sessionCreate = (
  title: string,
  model: string,
  systemPrompt?: string,
): Promise<SessionFile> =>
  invoke("session_create", { title, model, systemPrompt: systemPrompt ?? null });

export const sessionSave = (file: SessionFile): Promise<void> =>
  invoke("session_save", { file });

export const sessionDelete = (id: string): Promise<void> =>
  invoke("session_delete", { id });

export const turnAppend = (
  session_id: string,
  branch_id: string,
  role: Role,
  content: string,
  generated_by?: GeneratedBy,
): Promise<SessionFile> =>
  invoke("turn_append", {
    sessionId: session_id,
    branchId: branch_id,
    role,
    content,
    generatedBy: generated_by ?? null,
  });

export const branchFork = (
  session_id: string,
  from_turn: string,
  name: string,
): Promise<SessionFile> =>
  invoke("branch_fork", { sessionId: session_id, fromTurn: from_turn, name });

// ───────────────────────────── Helpers ─────────────────────────────

/** Build a linear chain (root → head) for the current branch. */
export function buildTimeline(file: SessionFile, branchId?: string): Turn[] {
  const id = branchId ?? file.head_branch;
  const branch = file.branches[id];
  if (!branch) return [];
  const chain: Turn[] = [];
  let cur: string | null = branch.head;
  const guard = new Set<string>();
  while (cur !== null) {
    if (guard.has(cur)) break;
    guard.add(cur);
    const t: Turn | undefined = file.turns[cur];
    if (!t) break;
    chain.push(t);
    cur = t.parent;
  }
  return chain.reverse();
}
