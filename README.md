# Loom

Local-only desktop test harness for experimenting with LLM context-window editing. Edit any message in a conversation, fork it as a new branch, compare responses side-by-side. Think of it as `git rebase -i` for your prompts.

---

## Status

- **v0.1.0-mvp** — linear chat, branching via edit-and-fork, git-style commit graph with colored lanes, side-by-side word diff between sibling responses, JSON-on-disk session storage.
- Provider: **Ollama** on `http://localhost:11434` (native `/api/chat`).
- Platform: desktop (Windows verified; macOS/Linux untested but scaffolded).

## Features

- **Edit any turn, fork a branch.** Editing never mutates — every change creates a sibling turn on a new branch. History is always recoverable.
- **Commit-graph sidebar.** Every session's DAG rendered as a compact git-style graph. Click any node to jump to its branch.
- **Per-branch colors.** Stable assignment by branch creation order — branch tabs, lane edges, and node strokes share one identity.
- **Side-by-side word diff** between sibling responses via jsdiff.
- **Streaming with metadata.** Token counts (prompt + reply), durations, and the exact outbound request body are persisted with every assistant turn.
- **Sampling knobs** (temperature, top_p, num_ctx, seed) per-send.
- **Atomic JSON storage** (temp-write + fsync + rename; `.bak` rotated on every save).
- **Remembers window geometry** across restarts.
- **Rolling context window.** Set a per-session turn limit; the oldest non-pinned turns drop out of the outbound request. Excluded turns stay visible in the timeline (dimmed, badged) so you can change the limit or pin one and they re-enter context.
- **Pin turns.** Click the pin icon on any turn to keep it in the outbound context regardless of the limit. The root system turn is always included by policy.

Phase-7+ features (prefill via `/api/generate` + `raw:true`, raw-JSON request editor, swipes, system-prompt library, multimodal) are planned but not in v0.1.0.

## Prerequisites

- **Rust** (stable, MSVC host on Windows) — install via [rustup](https://rustup.rs).
- **Visual Studio 2022 Build Tools** with the *Desktop development with C++* workload (Windows only — for the MSVC linker Tauri needs).
- **Node.js 20+** and npm.
- **Ollama** — install from [ollama.com](https://ollama.com) and pull at least one chat model:
  ```
  ollama pull llama3.1:8b
  ```
- **WebView2 runtime** (ships with Windows 11; installer otherwise pulls it automatically).

## Run

```
cd <this directory>
npm install
npm run tauri dev
```

First run compiles the Rust dependency graph (~10 minutes, one-time). Subsequent runs start in seconds.

Make sure Ollama is running in another terminal:
```
ollama serve
```

## Build

```
npm run tauri build
```

Outputs a Windows installer under `src-tauri/target/release/bundle/`.

## How Loom thinks about sessions

Every session is one JSON file under your user app-data directory:

- Windows: `%APPDATA%\loom\sessions\<ulid>.loom.json`
- macOS: `~/Library/Application Support/dev.loom.app/sessions/`
- Linux: `~/.local/share/dev.loom.app/sessions/`

A session is a small DAG:

- **Turn** — one message (system / user / assistant / tool). Immutable once written; identified by a ULID. Stores role, content, created_at, optional `generated_by` metadata (endpoint, model, exact outbound request body, token counts, durations).
- **Branch** — a named pointer to a head turn, optionally tagged with `forked_at` (the turn the branch diverged from) and `parent_branch`.
- **head_branch** — the branch currently being read/written.

Editing a turn creates a **sibling turn** (same parent, same role, new content) and a **new branch** pointing at it. `head_branch` advances to the new branch. The edited turn itself is never mutated — old responses stay visible under their original branches.

## Session file format (v1)

```json
{
  "loom_schema": 1,
  "session": {
    "id": "sess_01H...",
    "title": "Exploring refusal after persona shift",
    "created_at": "2026-04-16T12:00:00Z",
    "model": "llama3.1:8b",
    "default_options": { "temperature": 0.7 },
    "default_endpoint": "http://localhost:11434/api/chat"
  },
  "turns": {
    "t_01H...": {
      "id": "t_01H...",
      "parent": null,
      "role": "system",
      "content": "You are a helpful assistant.",
      "created_at": "2026-04-16T12:00:00Z",
      "generated_by": null,
      "annotations": [],
      "swipe_group": null
    }
  },
  "branches": {
    "b_01H...": {
      "name": "main",
      "head": "t_01H...",
      "created_at": "2026-04-16T12:00:00Z",
      "parent_branch": null,
      "forked_at": null
    }
  },
  "head_branch": "b_01H..."
}
```

All fields except `id`, `parent`, `role`, `content`, `created_at` are optional and may be absent in older files.

## Keyboard

- **Ctrl+Enter** in the composer — send.
- **Double-click** the session title — rename.
- **Esc** inside any modal — cancel.

## Context window

- On session create, optionally set a **context limit** (turn count). Leave blank for unlimited.
- Change it later by clicking the `ctx: …` value in the session header.
- Click the pin icon on any turn to exempt it from rolling out.
- The root system turn is always in context even if unpinned — it anchors the whole conversation.

## Layout

```
┌──────────┬──────────────────────────────────────┐
│ Sessions │  [branch tabs]                       │
│ sidebar  ├──────────────────────────────────────┤
│          │  Timeline of turns        │ Commit   │
│          │  (cards, Edit on hover)   │ graph    │
│          ├──────────────────────────────────────┤
│          │  Composer (CodeMirror + sliders)     │
└──────────┴──────────────────────────────────────┘
```

## Development

Run the full verification matrix before a commit:

```
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build
npx tsc --noEmit
```

## License

MIT — see [LICENSE](./LICENSE).
