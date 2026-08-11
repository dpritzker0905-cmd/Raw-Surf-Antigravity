# 11.2 evidence

* `render_oom_events.py` — read-only Render events probe. Reads `RENDER_API_KEY` from the gitignored
  `backend/.env`; the value is never printed, logged or committed. GET only — no service, env var or
  deploy is modified. Paginates the events feed and counts `oomKilled`.

**Result:** 26 `oomKilled` events, 2026-08-02T20:26Z → 2026-08-10T13:09:19Z, **all before the fix**,
zero since. Attribution window A (7.8 h, `0d9149b7` the only intervention active) is what separates
the code fix from the config fix.

**Calibration that keeps it honest:** 6 of 25 pre-fix gaps were ≥7.8 h and 5 of 25 were ≥10.9 h, so
neither window discriminates on its own. The largest pre-fix gap is **44.6 h** — a clean run past
that settles it. Re-read at 2026-08-11T13:57Z (48 h).
