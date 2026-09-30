# program/weather-simulation: frozen history (read this first)

**This folder is not current state.** Its `CURRENT_*` files (handoff, mission, execution state, release gate, task and
objective registers) are the August 2026 control documents of the weather program. The last commit here was
2026-09-22 (`59f8818e`). Nothing here is updated any more, so "CURRENT" in a file name means "current as of August".

Since 2026-09-29 the program's memory of record is **`docs/weather-program/`** (owner decision D-008): start at its
`README.md`, then `STATE.md`. Decisions are in `DECISIONS.md`, measured progress in `SCOREBOARD.md`, lessons in
`LESSONS.md`, and every action in the hash-chained `ACTIONS.jsonl`.

Read this folder as history: it records how the program got here (for example `STATE_OF_THE_ART_PATH.md`, 2026-08-14).
Do not write current state into it. Added 2026-09-30 by the memory audit (`docs/weather-program/log/2026-09-30-memory-audit.md`).
