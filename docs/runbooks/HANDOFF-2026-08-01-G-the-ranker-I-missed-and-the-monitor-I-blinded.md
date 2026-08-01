# HANDOFF 2026-08-01-G — the ranker I missed, and the monitor I blinded

**Read `-F` first** (`HANDOFF-2026-08-01-F-the-sim-reads-the-served-curve.md`) — this is its second
half, written after verifying my own work found two defects **in that work**.
**Topic memory:** `memory/sim-reads-the-served-curve-not-its-own-env-2026-08-01.md`.

Branch `dev` = `origin/dev` = **`b6ce6b08`**. CI green on `a1b320f3`
(**667 collected / 43 files / 595 passed / 0 failed**). The concurrent session's 12 files remain
untouched — staged by path throughout.

---

## 1. I THREADED FOUR CALL SITES AND MISSED THE ONE THAT RANKS (`a1b320f3`)

`5f19ac7d` (`-F`) reached `get_weather_forecast`, both sides of the what-if delta, and `sim_window`.
It **missed `sim_compare.scan`** — the function behind `find_best_spot` — **and
`sim_briefing.summary_line`**. Both already had the provenance in hand; `sim_compare` bound it as
`_prov` and threw it away.

⭐ **The result was worse than the original bug, because it was INCONSISTENT.** `find_best_spot`
RANKED on the global 1.2 m curve while `get_weather_forecast` DISPLAYED the local one, so the two
tools contradicted each other about the same break. Measured live before the fix, 4 regions × 8
neighbouring spots:

| centre | winner changes | rank displacement | reference spread |
|---|---|---|---|
| Cocoa Beach Pier | **YES** | 14 | 0.43 – 0.43 m |
| Lower Trestles | **YES** | 8 | 2.17 – 2.17 m |
| Kommetjie | **YES** | 8 | 2.07 – 2.71 m |
| Malibu First Point | no | 0 | 1.97 – 2.24 m |

⇒ **in 3 of 4 regions the tool recommended a different break than the app.**

### ★★★ AND IT REFUTES THE OBVIOUS INTUITION
*"Neighbouring spots share a reference, so switching the curve cannot reorder them."* **False.**
Cocoa's eight spots have an **identical 0.43 m** reference and the order still moved by **14**;
Trestles' are identical at 2.17 and moved by 8. `size_score` is **non-linear in the spot's own
breaking height** — the global branch saturates at an absolute 1.2 m, the local branch is anchored
at the reference and saturates at 2.5× it — so every spot moves by a **different** amount even under
a shared reference. **A uniform input to a non-linear function is not a uniform output.**
⚠️ Had I reasoned instead of measured, I would have called this cosmetic and closed it.

### Verified by PREDICTION, not by delta
The pre-fix A/B named the winner each centre *should* have under the served curve. Driving the real
`sim_compare.scan` against production afterwards landed on **4/4** — Cocoa → Minuteman Causeway,
Trestles → San Onofre, Kommetjie → Noordhoek, Malibu unchanged. **A prediction made before the
change and confirmed after is stronger than a difference measured after.**

### ★★ The missing thing was an INSTRUMENT, not a fix (rule 13)
`tests/test_sim_every_surface_reads_the_served_curve.py` **enumerates the call sites by AST** rather
than trusting that whoever threaded a parameter found them all — which is exactly what I failed to
do. Four parts, and the last is the one that matters:
* every registered surface must pass `served_reference_size_m` (AST over real Call nodes, so it
  reads what ships, not a docstring);
* a **negative control** that parses the precise broken shape I committed, and asserts the snippet is
  otherwise well-formed so the guard cannot pass by being malformed;
* **named exemptions with reasons** (`sim_boot`'s warmup has no baseline; `sim_health_probe`
  deliberately measures the lookup lane), plus a test that a stale exemption cannot outlive its call
  site;
* ⭐ a **coverage test that walks the tree** — `SURFACES` is a *claim* of completeness, not
  completeness, so a new surface must not be able to join the sim by simply not being listed.

Mutation-proven in a clean worktree: reverting `sim_compare` turns the guard red at the exact line.

---

## 2. AND MY FIX MADE THE PARITY MONITOR BLIND (`b6ce6b08`)

`sim_health_probe` kept resolving the **per-SPOT** reference through the flag+blob lookup (the
monitor supplies `RATING_LOCAL_SIZE=1` and `SUPABASE_*`), while every **tool** now uses the served
**per-CELL** reference. So the probe compared per-SPOT sim against per-SPOT glyph, read ≈0, and
**would have stayed GREEN while `get_weather_forecast` was up to ~18 points out.**

⇒ **A monitor whose composition differs from the tools it watches is measuring something adjacent.**
This is the hazard `-D` recorded against `valid_time`-as-permission ("the probe reads GREEN over the
one path a user reads"), one layer over — **and this time I created it.**

**TWO NUMBERS, TWO QUESTIONS** — the discriminator goes *in* the instrument (rule 14):

    d_score         "is the sim's COMPOSITION correct?"   <- what the gate fails on
    d_score_served  "is what the USER GETS correct?"      <- reported, attributed

Gating stays on the composition **deliberately**: it preserves the monitor's original meaning and
stops it paging daily on a known, documented, open item (E#1). The product number is **printed
regardless** — printing only the gated number is how a monitor stays green over an error its own
artifact already contains.

**The summary names which question failed, in BOTH directions.** The second is the more common case
off-CI, and it is not hypothetical — run locally:

    |dScore| composition   31.3   3/3 LEVEL differences
    |dScore| served-curve   1.5   0   LEVEL differences
    ATTRIBUTED: the COMPOSITION arm diverges more than the tools do (31.3 vs 1.5), and 0 of 3 rows
    resolved a lookup reference. That points at THIS PROBE's own reference lookup, not at the sim.

★ That 31.3 is a divergence the probe **manufactures** without credentials — exactly what `1fbd5e4e`
caught the monitor publishing as a physics finding. **Without the second arm there is no way to tell
it from a real break.** Rows also carry `reference_lane` and `served_reference_size_m`, and the
summary counts both lanes, so rows where the app sent no reference are visible as such — their two
numbers are identical *by construction* and averaging over them would dilute the gap.

---

## 3. ⛔ OPEN — RANKED

1. ⭐ **THE OWNER MUST RESTART CLAUDE CODE.** The MCP server is **PID 43516, a direct child of
   `claude.exe`** — an agent cannot restart it (killing it would kill the tool connection, and Claude
   Code does not respawn MCP servers mid-session). Until then `get_weather_forecast` keeps answering
   `reference_size_m: null` / delta +22.7. **After the restart no config change is needed.**
   Acceptance: `reference_size_m ≈ 1.93`, `parity.quality.delta ≈ −1.4`. ⚠️ `null` with a small
   delta is still **not** a pass.
2. ⛔ **E#1 — the per-CELL vs per-SPOT reference gap.** The dominant remaining accuracy term (median
   21.3%, max 52.5%). **It needs a route decision, not an edit:**
   * **(a) a `spot_id` query param on `/api/weather/point`** — recommended. The infobox and the sim
     both already know the spot; cost is one memoised dict lookup, and the serve process **already**
     loads the per-spot blob (`spot_conditions.py:288` calls `reference_for_spot`). Cross-stack.
   * **(b) a backend coordinate→spot proximity match** (the `confirmation_for` pattern) — no frontend
     change, but a **second blocking L2 read on the hottest endpoint**.
   * **(c) add `reference_size_m` to the precomputed spot-ratings frame record** — the sim already
     fetches that object for parity, and `sim_compare` fetches a whole bbox in one call. Makes the
     glyph payload self-describing. Costs bytes on an object every client downloads.
   ⚠️ Whichever route: the fix is **conditional** — spot reference AT a catalogued spot, cell
   reference elsewhere. The comment at `point_surf_augment.py:74-85` is **correct away from
   catalogued spots**; engage with it rather than deleting it.
3. **`-D` §4c is actionable** — `reference_for_spot` is on `origin/dev`, so the duplicate
   `_REF_MAP_MEMO` in `sim_rating.reference_size_for` can be collapsed onto it.
4. **`-D` §4e — the named-exemplars lane** for the probe, with the corrected rationale from `-F` §4.4
   (build it for **known values**, not sensitivity — top-N-by-score is biased *toward* reference
   sensitivity, 41.0 vs 8.7).
5. `weather_sim_mcp.py` is at **789/800 LOC**. ★ Note this is the same fix as `-E` #5 (the durable
   fastmcp fix): extracting the tool bodies so the sim's pure logic imports without a server
   framework would solve the ratchet **and** return the remaining excluded guards to CI.
6. Still open from `-E`: no deployed-SHA endpoint (#6).

---

## 4. WHAT THIS SESSION KEEPS TEACHING

★ **Verifying my own work is where both of this session's real defects came from.** The ranking miss
and the blinded monitor were each found by asking, after shipping, *"what else reads this?"* and
*"can the instrument still see the thing I just changed?"* — not by a test going red.
★★ **Measure the intuition, especially when it is obviously true.** "Neighbours share a reference so
the order can't move" is exactly the kind of claim that gets written into a handoff unchecked. It was
wrong in 3 of 4 regions.
