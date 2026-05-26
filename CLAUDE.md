<!-- trevec:rules:start -->

# 🧠 Unified Memory & Codebase Context Rules

These rules govern the use of our local memory layers (**Trevec**, **Mind**, and **Memstate**). They are **MANDATORY** for all agent sessions to ensure persistent learning, zero-latency context retrieval, and seamless recovery from compaction.

---

## 1. Trevec — Structural Codebase Graph
**Purpose**: Graph-aware code search, symbol lookup, and structural codebase context. Use Trevec instead of reading raw files manually.

### Available Tools
*   `get_context`: Natural-language search over codebase nodes. Returns relevant code spans and file paths. **Primary tool for codebase research.**
*   `search_code`: Targeted keyword or symbol (functions, classes) lookup.
*   `read_file_topology`: Structural map of a file (functions, imports, calls) — run before modifying any file.
*   `repo_summary`: High-level codebase onboarding (counts, top modules, detected conventions).
*   `neighbor_signatures`: Inspect external API dependencies of a set of files.
*   `batch_context`: Execute multiple codebase queries in a single roundtrip.

---

## 2. Mind — Persistent Session & Checkpoint Engine
**Purpose**: Long-term episodic memory, task checkpoints, design decisions, and post-compaction recovery.

### Session Lifecycle
1.  **Recover (Session Start)**: Call `checkpoint_query` to find active checkpoints, then load the target checkpoint using `checkpoint_load` to instantly restore context.
2.  **Orient**: Call `space_get` and `memory_query` with search keywords on the project space (e.g., `projects/raw-surf`) to load prior decisions.
3.  **Persist**: As milestones are met or non-obvious facts are learned, call `memory_add` with category tags (e.g., `cat:decision`, `cat:bugfix`, `cat:preference`).
4.  **Save Progress**: Update active checkpoints periodically using `checkpoint_save`.
5.  **Complete (Session End)**: Call `checkpoint_done` to transform the active checkpoint into a session summary inside `sessions/<repo>` and delete the checkpoint.

---

## 3. Memstate — Keypath-Structured Facts
**Purpose**: Persistent, keypath-structured architectural stack rules and static configuration facts.

### Usage
*   `memstate_remember`: Store a precise, versioned fact at an explicit keypath (e.g. `projects.raw-surf.stack.frontend` = `"React 18 + Craco + MapLibre GL"`).
*   `memstate_get`: Retrieve a structured fact by its path.
*   `memstate_list`: List all registered structured facts.

---

## 💼 Memory Dispatch Guidelines

| Task Type | Target System | Recommended Action / Tool |
| :--- | :--- | :--- |
| **Code Research / Symbol Lookup** | **Trevec** | `get_context`, `search_code`, `read_file_topology` |
| **Session Start / Recovery** | **Mind** | `checkpoint_query` ➔ `checkpoint_load` |
| **Decisions, Bugfixes, Discoveries** | **Mind** | `memory_add` with tags and links (`links_to`) |
| **Task Progress Updates** | **Mind** | `checkpoint_save` (update `pending` / `notes`) |
| **Session Closure / Summary** | **Mind** | `checkpoint_done` with completed summary |
| **Stack Constraints / Tech Specs** | **Memstate** | `memstate_remember` at structured keypath |

---

## 🛑 Strict Rules (Anti-Patterns)
*   **NEVER** do significant work without an active checkpoint in **Mind**.
*   **NEVER** let a session end without calling `checkpoint_done` to log a session summary.
*   **NEVER** create a Mind memory without at least one tag (e.g. `cat:decision`).
*   **ALWAYS** link related Mind memories together using `links_to` or `link_create`.
*   **ALWAYS** check file topology (`read_file_topology`) before editing a file.

<!-- trevec:rules:end -->
