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
  logprobs?: boolean;
  top_logprobs?: number;
}

export interface TopLogprobEntry {
  token: string;
  logprob: number;
  bytes?: number[];
}

export interface TokenLogprob {
  token: string;
  logprob: number;
  bytes?: number[];
  top_logprobs?: TopLogprobEntry[];
}

export type StreamEvent =
  | { kind: "delta"; content: string; logprobs?: TokenLogprob[] | null }
  | {
      kind: "done";
      prompt_eval_count: number | null;
      eval_count: number | null;
      prompt_eval_duration_ns: number | null;
      eval_duration_ns: number | null;
      total_duration_ns: number | null;
      // Observability fields (feat-loom-043). All optional; fields the provider
      // didn't surface are omitted from the serialized event.
      ttft_ns?: number;
      cached_tokens?: number;
      reasoning_tokens?: number;
      stop_reason?: string;
      refusal_label?: string;
      provider_id?: string;
      model_id?: string;
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
  ttft_ns?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  cost_usd?: number;
  stop_reason?: string;
  refusal_label?: string;
  provider_id?: string;
  model_id?: string;
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
  pinned?: boolean;
  thinking?: string;
  logprobs?: TokenLogprob[];
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
  context_limit?: number;
  default_seed?: number;
  tags?: string[];
  provider?: string;
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
  tags?: string[];
  provider?: string;
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

export async function ollamaContinueFromPrefill(
  model: string,
  messages: Message[],
  prefill: string,
  options: ChatOptions | undefined,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  await invoke("ollama_continue_from_prefill", {
    model,
    messages,
    prefill,
    options: options ?? null,
    onChunk: channel,
  });
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
  provider?: string,
): Promise<SessionFile> =>
  invoke("session_create", {
    title,
    model,
    systemPrompt: systemPrompt ?? null,
    provider: provider ?? null,
  });

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
  logprobs?: TokenLogprob[],
): Promise<SessionFile> =>
  invoke("turn_append", {
    sessionId: session_id,
    branchId: branch_id,
    role,
    content,
    generatedBy: generated_by ?? null,
    logprobs: logprobs ?? null,
  });

export const branchFork = (
  session_id: string,
  from_turn: string,
  name: string,
): Promise<SessionFile> =>
  invoke("branch_fork", { sessionId: session_id, fromTurn: from_turn, name });

export const branchForkFromEdit = (
  session_id: string,
  edited_turn_id: string,
  new_content: string,
): Promise<SessionFile> =>
  invoke("branch_fork_from_edit", {
    sessionId: session_id,
    editedTurnId: edited_turn_id,
    newContent: new_content,
  });

export const branchCheckout = (
  session_id: string,
  branch_id: string,
): Promise<SessionFile> =>
  invoke("branch_checkout", { sessionId: session_id, branchId: branch_id });

export const turnAnnotate = (
  session_id: string,
  turn_id: string,
  annotations: string[],
): Promise<SessionFile> =>
  invoke("turn_annotate", {
    sessionId: session_id,
    turnId: turn_id,
    annotations,
  });

export const turnPin = (
  session_id: string,
  turn_id: string,
  pinned: boolean,
): Promise<SessionFile> =>
  invoke("turn_pin", { sessionId: session_id, turnId: turn_id, pinned });

export const sessionSetContextLimit = (
  session_id: string,
  limit: number | null,
): Promise<SessionFile> =>
  invoke("session_set_context_limit", { sessionId: session_id, limit });

export const sessionSetTags = (
  session_id: string,
  tags: string[],
): Promise<SessionFile> =>
  invoke("session_set_tags", { sessionId: session_id, tags });

export const sessionSetModel = (
  session_id: string,
  model: string,
): Promise<SessionFile> =>
  invoke("session_set_model", { sessionId: session_id, model });

// ───────────────────────────── Provider-agnostic LLM ─────────────────────────

export interface ProviderModelInfo {
  id: string;
  name: string;
  provider: string;
  parameter_size?: string;
}

export async function llmChat(
  providerId: string,
  model: string,
  messages: { role: string; content: string }[],
  options: Record<string, unknown>,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  await invoke("llm_chat", {
    providerId,
    model,
    messages,
    options,
    onChunk: channel,
  });
}

export const llmListModels = (providerId: string): Promise<ProviderModelInfo[]> =>
  invoke("llm_list_models", { providerId });

export const llmListProviders = (): Promise<[string, string][]> =>
  invoke("llm_list_providers");

// ───────────────────────────── Garak ──────────────────────────────────────

export type GarakEvent =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "done"; exit_code: number; report_path: string | null }
  | { kind: "error"; message: string };

// ───────────────────────────── Settings ───────────────────────────────────

export interface AppSettings {
  ollama_endpoint: string;
  default_temperature: number;
  default_top_p: number;
  default_num_ctx: number;
  default_seed?: number;
  default_context_limit?: number;
  theme: string;
  first_run_done: boolean;
  api_keys?: Record<string, string>;
}

export const settingsLoad = (): Promise<AppSettings> => invoke("settings_load");

export const settingsSave = (settings: AppSettings): Promise<void> =>
  invoke("settings_save", { settings });

// ───────────────────────────── Prompt library ─────────────────────────────

export interface PromptEntry {
  name: string;
  content: string;
}

export const promptList = (): Promise<PromptEntry[]> => invoke("prompt_list");

export const promptSave = (name: string, content: string): Promise<void> =>
  invoke("prompt_save", { name, content });

export const promptDelete = (name: string): Promise<void> =>
  invoke("prompt_delete", { name });

// ───────────────────────────── Garak ──────────────────────────────────────

export async function garakScan(
  model: string,
  probes: string | null,
  generations: number | null,
  onEvent: (ev: GarakEvent) => void,
): Promise<void> {
  const channel = new Channel<GarakEvent>();
  channel.onmessage = onEvent;
  await invoke("garak_scan", {
    model,
    probes,
    generations,
    onEvent: channel,
  });
}

export async function garakCancel(): Promise<void> {
  await invoke("garak_cancel");
}

// ───────────────────────────── Helpers ─────────────────────────────

/** Generate a curl script that replays the branch chain against Ollama. */
export function exportAsCurl(file: SessionFile, branchId?: string): string {
  const chain = buildTimeline(file, branchId);
  const model = file.session.model;
  const endpoint = file.session.default_endpoint || "http://localhost:11434/api/chat";

  const lines: string[] = [
    "#!/usr/bin/env bash",
    `# Loom session: ${file.session.title}`,
    `# Branch: ${file.branches[branchId ?? file.head_branch]?.name ?? "main"}`,
    `# Model: ${model}`,
    `# Generated: ${new Date().toISOString()}`,
    "",
  ];

  const messages: { role: string; content: string }[] = [];
  for (const t of chain) {
    messages.push({ role: t.role, content: t.content });
    if (t.role === "assistant") continue;
    if (t.role === "system" && messages.length === 1) continue;
    const body = JSON.stringify({ model, messages: [...messages], stream: false });
    lines.push(`# --- ${t.role}: ${t.content.slice(0, 60).replace(/\n/g, " ")} ---`);
    lines.push(
      `curl -s ${endpoint} \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '${body.replace(/'/g, "'\\''")}'`,
      "",
    );
  }
  // Final request with full chain
  if (chain.length > 0 && chain[chain.length - 1].role !== "assistant") {
    const body = JSON.stringify({ model, messages, stream: false });
    lines.push("# --- final request ---");
    lines.push(
      `curl -s ${endpoint} \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '${body.replace(/'/g, "'\\''")}'`,
    );
  }
  return lines.join("\n");
}

/** Turns with the same parent as `turnId`, excluding the turn itself. */
export function findSiblings(file: SessionFile, turnId: string): Turn[] {
  const t = file.turns[turnId];
  if (!t) return [];
  const parent = t.parent;
  return Object.values(file.turns).filter(
    (u) => u.id !== turnId && u.parent === parent,
  );
}

/**
 * Compute the outbound Ollama `messages` chain after applying the session's
 * context_limit and per-turn pin state.
 *
 * Rules:
 * - Root system turn is always included (does not count toward the limit).
 * - Pinned turns are always included (do not count toward the limit).
 * - Of the remaining (non-root, non-pinned) turns, keep the most recent N
 *   such that N <= context_limit.
 * - If context_limit is null/undefined, everything is included — same behavior
 *   as raw `buildTimeline`.
 *
 * Returns the kept turns (in chain order) and a Set of excluded turn IDs so
 * the UI can dim them without re-computing.
 */
export function buildContextMessages(
  file: SessionFile,
  branchId?: string,
): { included: Turn[]; excluded: Set<string> } {
  const chain = buildTimeline(file, branchId);
  const limit = file.session.context_limit;
  if (limit == null) {
    return { included: chain, excluded: new Set() };
  }
  if (chain.length === 0) {
    return { included: [], excluded: new Set() };
  }

  const root = chain[0];
  const rest = chain.slice(1);
  const pinnedFromRest = rest.filter((t) => t.pinned);
  const unpinnedFromRest = rest.filter((t) => !t.pinned);

  const keptUnpinned =
    limit >= unpinnedFromRest.length
      ? unpinnedFromRest
      : unpinnedFromRest.slice(unpinnedFromRest.length - limit);

  const keptIds = new Set<string>();
  keptIds.add(root.id);
  pinnedFromRest.forEach((t) => keptIds.add(t.id));
  keptUnpinned.forEach((t) => keptIds.add(t.id));

  const included = chain.filter((t) => keptIds.has(t.id));
  const excluded = new Set<string>(
    chain.filter((t) => !keptIds.has(t.id)).map((t) => t.id),
  );
  return { included, excluded };
}

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
