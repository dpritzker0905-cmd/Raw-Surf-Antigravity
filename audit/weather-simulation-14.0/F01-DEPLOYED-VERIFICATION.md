# F-01 — deployed verification

**2026-09-20, 23:21–23:37 UTC.** Run against the **deployed** backend, not a local one.

| | |
|---|---|
| PR | #50, merged `2026-09-20T23:18:42Z` (`--rebase`) |
| `origin/dev` | `00c95d23374550a72b0e52cd637318eb02d9ac3d` |
| Backend `/api/health` | `…00c95d23…`, uptime **0h 0m 31s** at first read — a genuine restart |
| `dev--rawsurf` | `BUILD_VERSION 00c95d23` |
| Frontend under test | local `craco` build of the same tree → deployed backend |

⚠️ **SHA REWRITE, recorded so the audit trail resolves.** `--rebase` rewrote the commits: CI run
`35542391384` cites `af26d195`, which no longer exists on any branch. The deployed `00c95d23` and the
tested `af26d195` point at the **identical tree `832885cba12e6e0c43955e8ae50b1aa5bea9bd57`** and
`git diff` between them is empty, so the shipped content is byte-for-byte what CI tested.

## Why the timing matters
The browser ROUNDS "now" to the hour; the backend FLOORED it. They agree for 30 minutes of every
hour. **Every measurement below was taken at minute ≥ 30**, where the two anchors diverge by exactly
one hour — the only window in which this defect can manifest. At 23:30:17Z, measured in-page:

```
browser ROUND anchor : 2026-09-21T00:00:00.000Z
server  FLOOR anchor : 2026-09-20T23:00:00.000Z     <- one hour apart, as required
```

## 1. Backend contract — VERIFIED PASS
Direct against the deployed API (`evidence/f01_live.py`), clock-independent:

| case | `base_time` returned | `base_time_source` |
|---|---|---|
| no anchor (legacy client) | `2026-09-20T23:00:00Z` (server floor) | `server` |
| anchor `2026-09-21T00:00:00Z` | `2026-09-21T00:00:00Z` | `client` |
| far-future `2027-01-01T00:00:00Z` | falls back to `23:00:00Z` | `client_rejected` |
| malformed `not-a-timestamp` | falls back to `23:00:00Z` | `client_rejected` |
| non-hour `23:47:13Z` | snapped to `23:00:00Z` | `client` |

Frames for the honoured anchor: `2026-09-21T00:00:00Z`, `2026-09-21T03:00:00Z` — anchor and anchor+3h.

**Server-anchored vs client-anchored `base_time` delta = `1:00:00`.** That is the defect itself,
now correctable by the client. Pre-fix the delta was structurally always `0` because the anchor was
never transmitted.

## 2. Browser end-to-end — VERIFIED PASS
At 23:32:30Z, settled, waves layer rendering (`renderAccepted: true`, 117 vectors):

```
wheel              : handle 0, "Now"
requestedValidTime : 2026-09-21T00:00:00.000Z
selectedValidTime  : 2026-09-21T00:00:00.000Z      sampled: true   agree: true
gridProductId      : gfs_marine_waves_global_mid_20260921T000000Z.json
series sent        : base_time = 2026-09-21T00:00:00.000Z
series response    : base_time = 2026-09-21T00:00:00Z · base_time_source = "client" · frame0 = 00:00Z
```

The wheel says "Now" and the committed frame **is** the current frame. Pre-fix, at this same minute,
the series would have anchored at 23:00Z against a wheel showing 00:00Z.

⚠️ **A string comparison nearly produced a false defect here.** `requested` carries the browser's
`toISOString()` (`…00:00.000Z`) while `selected` can carry the backend's format (`…00:00Z`). These
are the same instant and compare unequal as strings. **Compare with `Date.parse`, never `===`.** An
early run of this check reported `agree: false` on three consecutive steps purely from that.

Scrub, 5 steps, comparing instants: **`allSameInstant: true`, `deltaHours: 0` at every step.**

## 3. Recovery — VERIFIED PASS
The original P1 symptom was a wheel reading "Now" while the map showed +20 h, unrecoverable by
ArrowRight, `Home`, or "Jump to now" (including a real pointer click). After scrubbing to +15 h and
panning/zooming, a **real pointer click** on "Jump to now" returned the clock to
`2026-09-21T00:00:00.000Z` = the current frame (`recovered: true`). **The unrecoverable state does
not reproduce.**

## 4. Slow-scrub control — coherent
Clean reload, 5 s between presses (well past any debounce):

| handle | clock offset (h) | requested == selected |
|---:|---:|---|
| 0 | 0 | ✓ |
| 1 | 0 | ✓ |
| 2 | 3 | ✓ |
| 3 | 3 | ✓ |
| 4 | 3 | ✓ |

`allReqEqSel: true`. Handle→frame follows **round-to-nearest-3h** (1→0, 2→3, 4→3), which is the
3-hourly marine cadence. *(My first predicate asserted `floor(h/3)*3` and flagged handle 2 as
inconsistent — the predicate was wrong, not the app.)*

---

## NEW, SEPARATE FINDING — F-12 · rapid scrubbing desynchronises the handle from the clock
**Severity P2 · Confidence HIGH · NOT a regression from this change · NOT F-01**

Driving **10 ArrowRight presses at 600 ms** (faster than the debounce), then a pan/zoom, then a real
"Jump to now" click, produced a state that was **stable across 20 s of no input**:

```
both wheels : handle 15, "+15 hours"
clock       : requested == selected == 2026-09-21T06:00:00.000Z   (offset +6 h)
```

Handle says +15 h, clock is at +6 h. Two independent observations:
- "Jump to now" **did** reset the clock (`recovered: true`) but did **not** reset the handle, and did
  not cancel the queued increments.
- With no further input the clock then drifted `00:00Z → 03:00Z → 06:00Z` over ~50 s as the queued
  presses drained.

This is a **latest-selection-wins / cancellation** gap — queued offset increments survive a reset —
not an anchor problem. `requested == selected` throughout, so the fetch path stays self-consistent;
the break is between the wheel's displayed offset and the clock's offset. It is in the same family
as F-07 (the wheel's 1-hour granularity over a 3-hourly field) and both should be looked at together.

Scoping note: this lane was untouched by `caaa5eb8`, which changes only the absolute anchor, not the
offset queue or the reset control. It is reachable only under input faster than the debounce, which
is why the slow-scrub control in §4 is clean — but "user drags the scrubber quickly" is an ordinary
gesture, so this is worth a real fix rather than a note.

---

## Verdict
**F-01 is CLOSED**: contract verified on the deployed backend, end-to-end agreement verified in the
browser inside the discriminating window, and the unrecoverable state does not reproduce.

**F-12 is opened** in its place, and is the more interesting remaining defect on this surface.
