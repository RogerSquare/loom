import { Channel, invoke } from "@tauri-apps/api/core";

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

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("ollama_list_models");
}

/**
 * Start a streaming chat request. `onEvent` fires for each delta/done/error.
 * The returned promise resolves when the stream closes cleanly; it rejects
 * if Ollama errors before any stream is opened.
 */
export async function ollamaChat(
  req: ChatRequest,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  await invoke("ollama_chat", { req, onChunk: channel });
}
