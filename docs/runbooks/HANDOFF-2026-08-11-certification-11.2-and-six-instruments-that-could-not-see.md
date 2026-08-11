# HANDOFF — Certification 11.2, and six instruments that could not see

**Session:** 2026-08-10 23:00 → 2026-08-11 21:30 (-04:00)
**Branch:** `dev` · started `e015d90b` · ended `dd996223` (pushed)
**Artifacts:** `audit/weather-simulation-11.2/` (26+ files) · **production code modified: yes,
6 commits, all frontend, all flag-reversible**

---

## 1. THE VERDICT

# ⛔ NOT CERTIFIED

A **truth-layer** verdict, not an architecture one. The rendering engine, transition ownership and
GPU resource lifecycle are genuinely good — I tried to break all three and could not. What fails is
the layer that tells you *what the number on screen is*.

| Gate | 1 Data | 2 Projection | 3 State | 4 Animation | 5 Science | 6 Capacity | 7 Regression | 8 Modernization |
|---|---|---|---|---|---|---|---|---|
| | **FAIL** | COND. PASS | **FAIL** | ✅ **PASS** | **FAIL** | COND. PASS | **FAIL** | **FAIL** |

Gates 2 and 6 were `BLOCKED/untested` at session start. Both are now measured.

**The decisive test:** with every `/api/weather/*` request rejected, activating a new layer left the
HUD reporting `LOADED · Provider NOAA · Class AUTHORITATIVE NATIVE · TRUTH VIOLATIONS: none` while
`productId` was `null`. It never recovered. **Reproduced on production.**

---

## 2. THE ONE THING TO CARRY FORWARD

Every significant defect this session — in the code *and* in my own work — was the same shape:

> **A confident number about something that was never separated.**

Six instances. Four were mine.

| # | instance | mechanism |
|---|---|---|
| 1 | `Class: AUTHORITATIVE NATIVE` | `marineData?.grid?.isEstimated` → `undefined` → falsy → **the confident branch**. The badge was green *because the data was missing*. |
| 2 | `parity match: true` | `mismatches.length === 0` — nothing comparable collapsed to PASS. |
| 3 | orphaned read | `renderedVectorCount` read 4×, **written 0×** since a rename ~10 weeks earlier. Pinned at 0 while 15,023-vector fields rendered. **Reports 11.0 AND 11.1 both cited its PASS.** |
| 4 | "10° coverage gap" *(mine)* | measured on a **local** backend (1,294 products) vs production (**19,995**, with 0.25° regional tiles). |
| 5 | "antimeridian never renders" *(mine)* | a screenshot at **10 s**; that view needs **20 s**. Published as CRITICAL, retracted. |
| 6 | "predicate still 100% miss" *(mine)* | a **cold cache**. Nothing to hit yet. Retracted in `28af6809`. |

**The rule:** *before calling a zero a defect, establish that it could have been non-zero.*
A zero without a positive control is not a measurement. (This repo already recorded that for the
γ census; I rederived it three more times the hard way.)

Also retracted: **all frame-rate readings.** RAF delivered **1 frame in 5 s** in the Browser pane —
unfocused-tab throttling. FPS is unmeasurable in this harness. Report 11.1 hit the same wall.

---

## 3. WHAT SHIPPED (6 commits, all pushed)

| commit | what |
|---|---|
| `516a7200` | **Truth layer.** `Class` multi-valued (`NO DATA` / `UNVERIFIED SOURCE` / `COARSE n°` / …); parity three-valued (`MATCH`/`MISMATCH`/`UNSAMPLED`) + `NOT_APPLICABLE`; orphaned read fixed; uninitialised-defaults guard; **tightest-containing cache selection** (the correctness half of T-2′). |
| `42e37ee7` | `requestTileId` + request-key alias in `_cacheMarineResult`. |
| `c2841396` | `recordSelectorLookup` — `sel_` namespace guard. |
| `e1542a36` | **Not my work** — the concurrent session's cut-2 refactor, landed with attribution because its pair couldn't split. |
| `877bdf04` | T-2′ Part B — thread the request tile, instrument the selector. |
| `c4bb5699`, `dd996223`, `1b662aed`, `b2a15212`, `28af6809` | audit + measurements. |

**Suite: 216 suites / 1999 tests green.** Kill switches: `__RAW_DISABLE_REQUEST_TILE_ALIAS__`,
`__RAW_DISABLE_TIGHTEST_CONTAINED__`.

Every code change was **mutation-verified** — the fix reverted in source, the test observed to fail,
then restored. A test that has never failed proves nothing.

---

## 4. T-2′ — FOUR SPECS DIED TO MEASUREMENT

The mission was re-specified three times, each time by evidence:

1. *"Make product selection a pure function"* — **REFUTED before a line was written.**
   `shouldRejectResolutionDowngrade(resident, …)` is deliberately residency-dependent and carries
   **five dated live regressions** (07-01 ping-pong, 07-05 island shadow, 07-06 GFS-under-EURO,
   07-12 band flicker, 07-03 stranded rectangle). ⛔ **Do not "simplify" it.**
2. *Exit criterion "identical `productId`"* — **REFUTED.** The same id served **289 vs 15,023
   vectors**. It would have PASSED while the field changed 52×. ⭐ *An identifier is not an extent.*
3. *"Close the empty-resident window"* — **REFUTED.** It self-heals in ~2.5 s
   (`global_mid` 2° → `florida_east_coast` 0.25°) then holds for 22 consecutive samples.
4. *The real defect* — the containment scan ended in `break` on the **first** match; `Map` iteration
   is insertion order, so cache history decided the field.

**Magnitude, measured by kill-switch A/B with cache warmth controlled and activation confirmed
(629 vectors both arms):**

| | ARM OFF | ARM ON |
|---|---|---|
| `exact_key_absent` | **16** | **0** |
| `hit` | 0 | 4 |
| `stale` | 0 | 12 |
| `hit_fallback` (O(N) scan) | **9** | **0** |

**Exact-key presence went 0/16 → 16/16.** Not a hit-rate improvement — the lookup went from
*structurally impossible* to *always present*. The O(N) scan was eliminated.
*Limits: one run per arm, n=16, local backend, GFS/hour-0/Florida.*

---

## 5. OPEN — RANKED

**1. F-STALE (new, production, unresolved).** `dd996223`. Production GFS waves was **4.5 h old vs
its own `freshness_sec: 1800` — 9× over**, and production has **no marine ingest job** (17 jobs,
none marine; local has `ingest_marine_forecast interval[4:00:00]`, production doesn't — products
arrive via `periodic_l2_restore`).
⚠️ **Two opposite fixes, do not conflate:** if the true cadence is hours, the defect is the
**declaration**; if the pipeline stopped, it's the **pipeline**. Settle by sampling `run_time`
hourly for a day — sawtooth ⇒ mislabelled budget; monotonic growth ⇒ stopped.

**2. Gates 1/3/5/7** — the verdict. See `AUTHORIZED_NEXT_PHASE_PACKET.md`. The HUD's
"TRUTH VIOLATIONS ✓" line still does **not** consume parity status in every path.

**3. Gate 2 residue** — DPR, resize, pixel-wise OceanMask registration, and **synthetic canonical
fields** (uniform E/W/N/S, vortex, checkerboard) remain absent, so row reversal / UV flip /
handedness are unverified **in either direction**.

**4. Gate 6 residue** — frame behaviour needs a **non-throttled harness**. Transfer is spiky:
+8.79 MB in one soak cycle, **+26 MB for a single mobile resize**; GPU particle budget stays
**87,616 on mobile** while CPU foam scales 2200/1000/500.

**5. Layer coverage asymmetry** — same `global_mid` tier: `waves` = 15,023 pts **global**,
`swell_2` = 289 pts over a **4°×4° patch**. The owner spotted it as "missing animations"; my sweep
missed it by holding the viewport over the covered patch. ⭐ *Vary what your harness holds constant.*

---

## 6. RIG NOTES (cost real time)

- **`/map` needs no login** — a seeded `dev-mock-user-id` in `localStorage` passes `ProtectedRoute`.
  Point the backend with `localStorage.__BACKEND_URL__`.
- ⛔ **Leaving `/map` for a social route logs you out** (dev-mock token 401s → session cleared →
  redirect). Blocks route-level remount testing; test layer on/off instead.
- ⛔ **A killed local backend looks exactly like a render bug.** Check the port first.
- ⛔ **Shared working tree.** A concurrent session edited the same files throughout. **Stage by
  path, always.** And note: *anything you commit can be pushed by them* — committing hands over the
  ship decision.
- ⚠️ `Select-String -SimpleMatch` treats a `|`-alternation regex **literally** — it reported my own
  fix as missing. Instance #5 above, self-inflicted.

---

## 7. IF YOU DO ONE THING

**Settle F-STALE.** It is cheap (hourly `run_time` samples), it is production, it sits on the gate
that already fails, and until it is settled nobody can tell whether the freshness number means
anything — which is the same disease as every other finding in this report.
