## Project Rules (binding)

- **THREE THEMES, ALL DEVICES (user mandate 2026-07-12):** every UI surface — map controls,
  legends, scrubber, admin panels, overlays, anything rendered — must work in **light mode, dark
  mode, AND beach mode**, on **desktop AND mobile** (and other devices). Use `useTheme()` from
  `contexts/ThemeContext` and theme-aware class patterns (see MapWeatherControls'
  `isLight`/`isBeach` + `textMuted`/`chipBg`/`bgClass` variables, or the shared `ui/*` primitives
  in admin). Never hardcode single-theme colors. Components with separate desktop/mobile layouts
  (MapWeatherControls has three: desktop panel, mobile collapsed float, mobile expanded sheet)
  need changes mirrored across ALL layouts.

<!-- trevec:rules:start -->

## Trevec MCP Tools

Use these MCP tools to retrieve precise, graph-aware code context instead of reading files manually.

### get_context
Retrieves relevant code context for a natural-language query. Returns relevant code nodes with file paths, spans, and related context. **Use this as your primary tool for understanding code.**

### search_code
Hybrid search over indexed code nodes. Returns ranked results with file paths and signatures. Use for targeted symbol or keyword lookup.

### read_file_topology
Returns the structural topology of a file: all code nodes (functions, classes, methods) with their relationships (calls, imports, contains). Use to understand file structure before making changes.

### repo_summary
Returns a high-level overview of the repository: languages, file/node/edge counts, top-level modules, entry points, hotspots, and detected conventions. Use for onboarding or getting a quick sense of a codebase.

### neighbor_signatures
Given a list of file paths, returns the external API surface those files depend on — imported symbols from other files with their signatures.

### batch_context
Runs multiple `get_context` queries in a single call. Each query can have its own budget and anchor count. Reduces round-trips for multi-query workflows.

### remember_turn
Records a conversation turn into episodic memory. Call this when the user shares important context, decisions, or preferences that should persist across sessions.

### recall_history
Searches episodic memory for past conversation context. Use when the user references previous discussions or when historical context would help answer a question.

### Guidelines
- Prefer `get_context` over reading raw files — it returns only the relevant code with graph context.
- Use `search_code` for quick symbol lookups (function names, class names, error messages).
- Use `read_file_topology` before modifying a file to understand its structure and dependencies.
- Use `repo_summary` for onboarding or to get a quick overview of the codebase structure.
- Use `neighbor_signatures` to discover imports/dependencies of specific files before editing.
- Use `batch_context` when you need context for multiple queries — saves round-trips.
- Call `remember_turn` for important decisions, preferences, or context the user shares.
- Call `recall_history` when the user says "we discussed", "last time", or references prior work.

<!-- trevec:rules:end -->
