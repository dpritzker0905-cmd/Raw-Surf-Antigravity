# UPDATED CRITICAL PATH — Audit 12.2

**Does the Audit 12.1 critical path remain valid?**

> **It is not wrong. It is spent, and two of its single-point blockers rest on premises that are
> false at HEAD.**

---

## 1. What changed underneath it

12.1's path opened with `WS-CAN-0061` as the authorised mission and `WS-CAN-0027` as "immediately
after". Both shipped, in the seven commits between 12.1's publication commit (`3f83bbdb`) and this
audit's baseline (`791fdf78`):

| # | 12.1 position | commit | status |
|---|---|---|---|
| ① | WS-OBJ-101 ← WS-CAN-0061 — **AUTHORIZED MISSION** | `f3fe2c85` | ✅ closed |
| ⑩ | WS-OBJ-503 ← WS-CAN-0027 — "immediately after" | `181b7ba7` | ✅ closed |
| ② | WS-OBJ-506 ← WS-CAN-0063 + 0010 | `69ac3ddb` | ✅ closed |
| ③ | WS-OBJ-203 ← WS-CAN-0014 | `172f66aa` | ✅ closed |

**Four of the nine Finish Line A positions and one of Finish Line B's closed in one day.** No audit
in this program has previously had its whole authorised sequence complete before the next review.

## 2. Two blockers whose premises are false

### `WS-CAN-0037` — "frame rate is unmeasurable; no headed harness exists"

12.1 lists it as the single largest unlock: *"unblocks WS-CAN-0028 and Gate 3 → Gate 6 and every
retracted FPS reading."* Estimated half a day to **build** a harness.

Measured at HEAD:

- `useWebGLGuardrail.js:126` — `window.__MAP_RENDER_FPS__ = fps`, **written every second by the
  running application.**
- `marine-nightly.yml` — Playwright chromium with `--disable-background-timer-throttling`,
  `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`, a per-frame trace
  synchronised on `map.on('render')`, and a most-recent run reporting **387 anim frames**.

The true statement was always narrower: *the **agent browser pane** cannot composite.* That hardened
into a belief about the platform. **WS-CAN-0037 shrinks from "build one" to "read the one that
exists" and moves from CLOSE-NOW-sized to a one-hour VERIFY item.**

### `WS-OBJ-503` — certified on WS-CAN-0027 as closing the recording gap

The certificate is defensible for the E2E lane and its forensic note is excellent. But it closed the
**second** `.webm`-producing lane. The first has run nightly since 2026-07-18 and appears **zero
times** in either canonical register. **Re-issue the certificate with the correct scope** — governance
rule 16 (a closure states what it did *not* establish) applies to what it did not *know*, too.

## 3. The reordering, and why

```
                        ┌──────── OWNER TRACK (parallel, no engineering) ─────────────────┐
                        │ WS-CAN-0039 unfreeze prod ──► unlocks the VALUE of EVERY        │
                        │ WS-CAN-0026 threshold (⏰ arms 08-22)   frontend finding here    │
                        │ WS-CAN-0025 heartbeat URL + point healthCheckPath at            │
                        │             /api/health/data                                    │
                        │ WS-CAN-0021 rotate · WS-CAN-0055 prune · WS-CAN-0040 env screen  │
                        └─────────────────────────────────────────────────────────────────┘

FINISH LINE A — RELIABLE PRODUCTION BASELINE
  ★ WS-CAN-0066  the scheduled alert states the quality   ◄── AUTHORIZED MISSION  [NEW]
       │            the only Critical that reaches a user TODAY
       ▼
  ② WS-OBJ-202/203/207 ← WS-CAN-0005 + 0062 + the run_time DISPLAY half  [one provenance visit]
  ③ WS-OBJ-301  bounded lifecycle    ← WS-CAN-0022   [one cancel path]
  ④ WS-OBJ-302  bounded latency      ← WS-CAN-0064 EXPANDED (two routes) + WS-CAN-0009
  ⑤ WS-OBJ-206  one composition/hour ← WS-CAN-0007
  ⑥ WS-OBJ-103  detect/disclose/recover ← WS-CAN-0036
  ⑦ WS-OBJ-104  release delivery     ← WS-CAN-0039   [OWNER — gates the VALUE of ⑧⑨⑩]
  ⑧ WS-CAN-0069 the second renderer                                        [NEW]
  ⑨ WS-CAN-0068 the 261-global override inventory                          [NEW]
  ⑩ WS-OBJ-705  reopened PARTIAL — the WebKit flake class                  [REOPENED]

  ┌─ VERIFY LANE (parallel, zero production change, NOT blocked by anything) ──────────┐
  │ V1 read the zoomlab red + video   ⏰ expires 08-27   → WS-CAN-0067                  │
  │ V2 read the WebKit failure video  ⏰ expires 08-27   → WS-OBJ-705 · WS-CAN-0018/19  │
  │ V3 read __MAP_RENDER_FPS__ on hardware GL           → rescopes WS-CAN-0037         │
  │ V4 one sustained-load run                           → CLOSES WS-OBJ-303            │
  │ V5 the 27-workflow census                           → WS-CAN-0067                  │
  └────────────────────────────────────────────────────────────────────────────────────┘
                                          │  V1 and V3 unblock ↓
FINISH LINE B — SOTA CORE
  ⑪ WS-OBJ-502  tests that can fail   ← WS-CAN-0018/0019   (V2 tells you fix-or-delete)
  ⑫ WS-OBJ-102  projection both ways  ← WS-CAN-0028  ← the ONLY thing that grades whether
  ⑬ WS-OBJ-304  pipeline integrity    ← WS-CAN-0017 EXPANDED    painted values are CORRECT
  ⑭ WS-OBJ-504  telemetry uplink      ← WS-CAN-0020 + the override state + fallback events
  ⑮ WS-OBJ-402  exit the 3 dual paths ← governance, dated
  ⑯ WS-OBJ-401  one authority         ← WS-CAN-0016/0022/0033 + the alert pair

FINISH LINE C — unchanged from 12.1. Nothing in 12.2 moves it.
```

## 4. Classification of every new gap against the path

| Gap | Classification |
|---|---|
| The scheduled alert states no quality (`WS-CAN-0066`) | **Insert before current mission** — it *is* the current mission |
| The zoomlab red is standing unread | **Verify in parallel**, with a stop condition: if 06:30Z is also red it **inserts before** everything |
| The WebKit flake class | **Verify in parallel**, then add to the mission that follows |
| `WS-CAN-0037`'s premise | **Does not affect critical path** — it *shortens* it |
| The second renderer | **Add after current mission** |
| The 261-global surface | **Add after current mission** — inventory first, decisions later |
| No branch protection on `dev` | **Add after** — it is a governance change with an owner, and three consecutive audits record zero code regressions |
| PostHog / tile providers not in the dependency register | **Verify in parallel** — a register edit |
| The `/api/health` "blindness" | **Does not affect critical path — REFUTED** |
| The flag-lane parity class | **Add after** — fold into `WS-CAN-0040` as a repeating check |
| `/api/weather/grid_series` also breaches 10 s | **Add to current** `WS-CAN-0064` scope, same visit |

## 5. Is the path shortening?

**Yes, and for the second consecutive cycle — but the honest reason has changed.**

| Finish Line | blocking at 12.0 | at 12.1 | **at 12.2** | Δ |
|---|---|---|---|---|
| A — Reliable Baseline | 10 (implied) | 11 | **9** | **−2** |
| B — SOTA Core | 15 (implied) | 14 | **12** | **−2** |
| Advanced differentiation | — | — | 2 | — |
| Supporting / optional | 5 | 4 | 7 | +3 |

*Counted from `UPDATED_FINISH_LINE_GAP_MATRIX.csv` (44 rows) by excluding the seven L1 roll-ups and
every row whose Current State reads CERTIFIED, then bucketing on the highest requirement column.
**4 closed · 4 opened · 1 reopened · 2 scope-corrected · 5 expanded** — so the −2/−2 is a real
reduction that absorbed four new objectives on the way.*

12.1's honest headline was *"the path is shorter than 12.0 measured it, and longer than 12.0
described it."* 12.2's is different:

> **The path is shorter than 12.1 measured it, because four of its positions closed in a day — and
> the largest remaining unlock is not on it at all.** The VERIFY lane closes or rescopes four
> objectives for a few hours of reading, touches no production code, and appears nowhere in the 12.1
> critical path, because a path built from a register of *work* has no position for *reading*.

## 6. What must not begin yet

- Any Tier-3 research task (`WS-CAN-0046`–`0051`). Prerequisites unchanged; 12.2 strengthens the case
  against them.
- `WS-CAN-0058` coverage expansion — needs a cadence measurement **and** a bytes-per-model-run figure
  that nothing measures.
- Any deletion of the 261 globals. **Inventory before decisions.**
- Any canary — still blocked on `WS-CAN-0044` (`p2.py` precedence inversion).
- Any flag flip. Owner-gated, unchanged.
