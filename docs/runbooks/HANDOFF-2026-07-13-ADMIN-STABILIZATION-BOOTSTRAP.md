# Admin Stabilization — Bootstrap Handoff for a Fresh Context

**Read this first if you're picking up admin-panel work with no prior context.** It exists so you don't have to rediscover things that already cost real time to figure out once.

**Status at a glance:** the admin-panel Jacobian audit arc (6 rounds) is **closed** — every known issue found was fixed and live-verified, or explicitly deferred with a documented reason. One large, separate finding (user-identity auth architecture, §7) is **open and deliberately not started** — it's the natural next thing to work on, but needs a scoping decision first, not a reflexive fix.

---

## 1. What "the admin" is in this codebase

The user refers to three surfaces, which map to specific code like this:

| User's name | Code | How to reach it |
|---|---|---|
| "Raw Surf app admin" | Legacy Dashboards tab group (Event Inbox, Decisions Queue, Booking Trace, Media Review, System Health) | `frontend/src/admin/AdminApp.tsx` — the default view at `/admin` |
| "legacy console" | `UnifiedAdminConsole.js`, ~22 tabs (Overview, Access Control, Compliance, Moderation, Content Queue, Verification, Analytics, Support, Comms, System, Surf Forecast, Finance, Content, Persona, Live Sessions, Users, Spots, Map Editor, Queue, Pricing, Ads, Competition, Logs) | Click **"Legacy Console Tools"** button from the default `/admin` view |
| "Raw Surf OS admin sync" | "AI Operations Console Advanced Overlay", 9 tabs (Decision Workbench, Booking Lifecycle, Event Graph Explorer, Event Replay Engine, Root Cause Analyzer, Simulation Sandbox, Live System Map, Social Intelligence, Weather Diagnostics) | The default `/admin` view itself, branded "RAW SURF OS · Admin Sync" |

All backend admin routes are `/admin/*`-prefixed (mostly) and gated by `Depends(get_current_admin)` from `backend/deps/admin_auth.py`.

---

## 2. What's already been done (full detail in the runbook, this is the condensed version)

**Canonical document:** `docs/runbooks/ADMIN-PANEL-JACOBIAN-AUDIT-2026-07-12.md` — §0-21, every claim has file:line evidence and (from round 3 onward) live curl/browser proof, not just static reading. Read this before assuming anything about the admin surfaces is broken — it's very likely already checked.

Six rounds, chronologically:
1. **Original audit + Phases 0-5**: found and fixed 2 real security vulns (`admin_sessions.py` zero-auth, `analytics_settings.py` platform-settings leak), route-shadowing bugs, a hardcoded SQLite path, missing imports, fabricated "Stripe/Calendar synced" confirmation text (replaced with real integration calls where they exist, honest "not integrated" labels where they don't), fake campaign-delivery percentages (replaced with real OneSignal/Resend sends), a scheduler-job-tracking gap, 2 dead UI toggles, and a full tri-theme (light/dark/beach) retrofit of the 9 advanced-overlay components.
2. **Re-audit round 1**: found + fixed a **live money-handling bug** introduced by Phase 3 itself — a commission-rate tier-key mismatch (`get_commission_rate_for_tier()` checked for `"tier_2"/"tier_3"` but real photographers' `subscription_tier` is `"basic"/"premium"`) that made every real photographer pay the wrong commission rate.
3. **Round 2 (Map Editor bug report)**: root-caused "Map library failed to load" to Leaflet never being loaded anywhere in the app (no npm dep, no CDN script, ever) — fixed by adding `leaflet` as a real dependency + a shared loader, which also fixed 3 other silently-broken consumers, including a real user-facing feature (`UnifiedSpotDrawer`'s "Refine Location" modal). Also found + fixed a systemic SQLite migration gap (`server.py`'s dev-DB migration path never had column-add logic, unlike the Postgres path) while live-testing all 22 legacy console tabs.
4. **Round 3**: root-caused (via live debug instrumentation) and fixed a React effect-ordering race that left Map Editor's spot markers never rendering; proved the write-direction of the Jacobian lens (not just reads) via a real "Snap Offshore" click that produced a verified, exact-value database mutation.
5. **Round 4/5**: wrote an AST-based scanner (not regex — see §6 for why) covering all 930 backend routes, found + fixed 6 more genuinely unauthenticated bulk-mutation endpoints (`admin_spots.py`, `spot_dedup.py`, `condition_reports/admin.py`) — none had any frontend caller, so this was a pure backend fix.
6. **Final pass**: re-verified every fix above is still live in source, closed 2 documentation inconsistencies, found 2 more concrete exposure examples while stress-testing the scanner's own assumptions.

**Test baseline throughout: 669 passed / 0 failed / 2928 skipped** (backend pytest suite — the 2928 skips are intentional, this suite requires a live server per `conftest.py`'s policy). This number should still be 669/0/2928 when you start; if it isn't, something changed outside this audit arc.

**Commits, in order:** `71009d03` → `22c304d3` → `969ac20e` (shared with a concurrent session) → `249db14f` → `6a940031` → `8faba42f`, all on `dev`, all pushed.

---

## 3. What's open — the big one

**`docs/runbooks/HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md`** — a dedicated, comprehensive research report (not a fix) on a separate, much larger finding surfaced while building the round-4/5 scanner: **221 of 930 backend routes** (corrected from an initial miscounted 309) trust a bare `user_id` parameter with **zero** cryptographic identity verification. This is textbook OWASP API1:2023 Broken Object Level Authorization (BOLA/IDOR) — the #1 API security risk since 2019.

Read that report in full before doing anything here. The condensed version:
- This exact problem was declared "fixed" twice before in this codebase's history (April 21, April 30) and drifted back on new/missed code — it's a governance problem, not a one-time bug.
- The frontend **already** sends a real, verified Bearer token on every request unconditionally (`frontend/src/lib/apiClient.js`'s axios interceptor) — meaning the actual fix is much lower-risk than 221 routes sounds: swapping the bare parameter for the codebase's own existing `get_user_id_from_jwt_or_query` migration-bridge helper (already used 97 times elsewhere) would work immediately for every real logged-in user with **zero frontend changes**.
- Real confirmed exposure includes credit balance/history, payment history, a private-message inbox list, friends'-location map data, a Stripe Identity verification session creatable as an arbitrary user, and a credit-spending "dispatch boost" endpoint.
- The most safety-sensitive area of the app (`grom_hq`, parental/child-safety controls) is **already fully protected** — the gap skews toward routine social/financial/messaging endpoints instead.
- The report's own recommendation is **not** to bulk-fix this. Phase 0 is deciding an enforcement mechanism (a cheap CI/lint check reusing the existing scanner) so the pattern can't silently drift a third time, *before* touching any of the 221 routes. Then triage into "clearly the caller's own data" (mechanical, safe fix) vs. "intentionally looking up another user's public data" (needs a human judgment call per route, not a script). Then build a cross-account regression test suite. Then roll out by domain, financial/private data first — explicitly not as one big PR.

**If the user asks you to start on this, begin at Phase 0 in that report, not by editing routes.**

---

## 4. How to test the admin panel locally (the recipe that took real trial and error to work out)

1. **Start the local backend**: `preview_start` with `name: "backend"` (maps to `python backend/server.py` in `.claude/launch.json`). Takes ~60-90s to fully come up (Copernicus product validation on startup) — poll `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/health` rather than trusting the log tail, which can look stuck while the server is actually already responding.
2. **Start the local frontend**: `preview_start` with `name: "frontend-live"` (port 3001).
3. **Point the frontend at the local backend, safely, without touching any file**: the app already has a documented override for exactly this — in the browser console (or via `javascript_tool`):
   ```js
   localStorage.setItem('__BACKEND_URL__', 'http://127.0.0.1:8000');
   ```
   then reload. **Do not skip this.** `frontend/.env.local` points `REACT_APP_BACKEND_URL` at the *deployed production* Render backend by default (documented in that file itself) — testing mutating admin actions without this override means testing against real production data.
4. **Auth as admin without a real login flow**: `Authorization: Bearer dev-mock-user-token` — `backend/core/security.py` maps this literal string to `"dev-mock-user-id"` whenever `ENV`/`IS_PROD` isn't set to production. The seeded dev profile for this ID is already an admin (confirmed live: shows as "Dev User" with "Role: Cryptographic Admin" in the UI).
5. **Navigating the UI in the Browser pane**: clicking tabs via `document.querySelector('[data-testid="admin-tab-<id>"]').click()` (via `javascript_tool`) is far more reliable than `computer` click-by-coordinate in this environment — coordinate clicks have silently landed on stale positions after a layout shift more than once this arc. `computer {action: "screenshot"}` has also timed out repeatedly and consistently in this environment; rely on `read_page`, `get_page_text`, `read_network_requests`, and `read_console_messages` for verification instead — this has been more than sufficient proof throughout this entire audit arc (curl + DOM/network state, not pixels).
6. **When you're done, stop both preview servers** (`preview_stop`) — leaving them running mid-session and then stopping them later has once caused a real "it broke!" user report that was actually just the test server going down, not an app bug (confirmed via `net::ERR_CONNECTION_REFUSED` in the network log, then a clean retry). If you stop the servers, say so, or the next person testing manually may get confused by the exact same false alarm.

---

## 5. Landmines specific to this admin work (don't rediscover these)

- **Two divergent local `dev.db` files exist**: `C:\Users\dprit\Raw-Surf\dev.db` (repo root) and `C:\Users\dprit\Raw-Surf\backend\dev.db`. `database.py` uses a relative SQLite path, which resolves against whatever directory the server process's cwd happens to be — and the `backend` launch config runs from the repo root, so **the repo-root file is the one that's actually live**. If you manually inspect a DB file, make sure you're looking at the right one. This is now less dangerous than it was: `server.py::ensure_database_tables()` was fixed this arc to self-heal missing columns on the SQLite path (previously only the Postgres path had that logic) — but the two-file confusion itself is unresolved and could still bite in some other way.
- **React StrictMode double-invokes effects in dev** — if you're debugging a "this only sometimes works" React bug in the admin UI, expect to see every effect's mount/cleanup/remount sequence twice in the console logs. This was the initial red herring in the Map Editor marker-render race (round 3) before the real cause (an effect racing a network fetch, with no dependency to re-trigger it once the race resolved) was found via added debug logging, not by reasoning about StrictMode alone.
- **This repo has a concurrent session actively working in the same working tree** (unrelated marine/weather-engine work, visible in `git log` interleaved with the admin commits above). Always `git status` and stage admin-specific files individually before committing — a broad `git add -A` from either side has swept the other's staged files into a commit at least once this arc (harmless when caught, verified via `git show --stat`, but check). Also: `.agents/skills/**`, `.claude/skills/**`, and `skills-lock.json` show as perpetually modified across sessions — not yours to commit either way, leave them alone.
- **Prefer AST-based static analysis over regex for anything checking function signatures.** Regex broke on nested `Query(..., description="...")` parentheses twice in this arc, producing real false positives in security-relevant scans both times. Python's `ast` module, walking `@router.<method>("path")`-decorated functions and checking parameter defaults for known auth-marker names, is the pattern that held up under scrutiny — reuse it rather than rebuilding a regex version.

---

## 6. Established methodology worth continuing

- **"Jacobian lens"**: for any admin control, check the partial derivative is non-zero in *both* directions — does real feature data actually flow into the admin view, and does an admin action actually flow out into real feature state? Early rounds of this arc only tested the read direction; round 3 explicitly closed that gap by proving a write (a button click → a verified, exact-value database mutation), which is a stronger and more complete standard than "the page loads without erroring."
- **Live proof over static reading, wherever a live backend can be stood up.** Nearly every fix in this arc was verified with an actual curl request or browser interaction showing the before/after state change, not just "the code now imports the right thing." Where static reading was necessary (e.g. checking git history), it was cross-checked against source directly rather than trusted from a commit message alone — this caught the "second commit claimed complete but wasn't" story in the BOLA report.
- **Manually verify anything a script/scanner flags before acting on it.** Every automated sweep in this arc (regex, then AST) produced at least one false positive at some point, always caught by reading the actual flagged code before fixing it. Don't skip that step just because the tool output looks confident.
- **Path-scoped `git add`, never `-A`, in this shared repo.** Check `git status`, stage exactly the files you touched, confirm with `git diff --cached --stat` before committing.

---

## 7. Document map

| Document | What it's for |
|---|---|
| `docs/runbooks/ADMIN-PANEL-JACOBIAN-AUDIT-2026-07-12.md` | The canonical, cumulative audit record — §0-21, read this first for "has X already been checked" |
| `docs/runbooks/HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md` | The open BOLA finding — full research report, not yet acted on |
| `docs/runbooks/HANDOFF-2026-07-13-ADMIN-STABILIZATION-BOOTSTRAP.md` | This document |
| Memory: `admin-panel-jacobian-audit-2026-07-12.md` | Same content as the runbook, chronological update log, for future-session recall |
| Memory: `app-wide-userid-auth-gap-2026-07-12.md` | Same content as the BOLA report, condensed |
| Memory: `MEMORY.md` (index) | One-line pointers to both of the above — read this first, it's always loaded into context automatically |

---

## 8. Recommended next step

If the user wants to keep stabilizing the admin panel with no further direction: there is currently **no known open admin-panel-specific bug**. The natural next thing is the BOLA finding (§3) — but that needs the user to explicitly choose to proceed past Phase 0, not a unilateral start. If unsure, surface §3's summary and ask.
