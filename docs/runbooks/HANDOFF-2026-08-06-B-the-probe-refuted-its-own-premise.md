# HANDOFF — 2026-08-06 (B) · the probe refuted its own premise, and a disclosure reached 1 of 4

**For a fresh session. Everything measured. Read §0 and §1 first.**
Predecessors: `HANDOFF-2026-08-06` · `MASTER-AUDIT-8.0` · `7.0`

---

## §0 THE FIVE THINGS THAT WILL BITE YOU FIRST

1. ⛔⛔ **A SECOND SESSION IS LIVE IN THIS TREE.** It pushed 3× mid-flight today (WebSocket
   handshake, a hardcoded dev token authenticating against PRODUCTION, estate floor 247→275).
   **Stage by path, `git fetch` before every push, and expect to rebase.** No file overlap occurred,
   but the race is real.
2. ⛔⛔ **EVERY PUSH TO `dev` IS A PRODUCTION BACKEND DEPLOY**, 5–30+ min. A local E2E run against a
   redeploying backend fails at the LOAD GATE and looks like a code bug. `/api/health` embeds the SHA.
3. ⛔ **`weather_sim_mcp.py` IS AT EXACTLY 800/800 LOC.** The ratchet blocks at 801. The next
   addition there must move something out first — and the house rule is **move rationale to docs,
   never delete it** (`RATIONALE-2026-08-04-moved-for-the-loc-ratchet.md` is the destination).
4. ⛔ Don't `gh workflow run` E2E while a push-triggered run is in flight — `concurrency.
   cancel-in-progress: true` means the dispatch **cancels** the push run.
5. ⚠️ **ecCodes/pygrib do not work on this Windows box.** GRIB decoding belongs on Linux, where
   `pygrib` already ships in `requirements.txt`. A local import check answers "is it here", never
   "will the runner have it".

---

## §1 THE RESULT THAT SHOULD CHANGE THE QUEUE: the exposure probe refuted its own hypothesis

`scripts/directional_exposure_probe.py`, 47.6 years of hourly ERA5 through the production geometry
chain, **n = 139,040 samples per spot**:

| | Arugam Bay (subject) | Hossegor (control) |
|---|---|---|
| shore normal | 100.1° | 279.7° |
| floored, **all hours** | **16.8%** | 0.3% |
| floored, **top decile** | **0.74%** | 0.0% |
| floored, **top percentile** | **0.0%** | 0.0% |
| median Δθ, top decile | 25.5° | 21.4° |
| biggest-10 exposure range | 0.776 – 0.99 | 0.877 – 0.982 |

**THE COSINE MODEL IS NOT WRONG AT ARUGAM BAY.** The premise was that point breaks work by
refraction and wrapping, so a half-plane cutoff should systematically floor their best days.
Measured: **99.26% of the biggest decile is NOT floored and 100% of the top percentile is NOT
floored.** Its ten biggest waves ever all sit at exposure 0.78–0.99.
✅ **The control makes this readable** — Hossegor, an open beach the cosine *should* get right, shows
0.3% / 0.0%. The probe can return "the model is fine here", and it did, for both.

⚠️ **THE FLOOR STILL BITES 16.8% OF ALL HOURS AT ARUGAM — just not the good ones.** That is a
refinement of SOTA ledger row 1, not a dismissal of it.
⛔ **ONE THING UNRECONCILED, DO NOT SKIP IT:** the probe's own docstring records Arugam Main Point
reading **3.9/100 on 5.1 ft / 10 s / 15 kt OFFSHORE**, live. The climatology says such hours exist
but are not the big ones. So either that frame was one of the 16.8%, or the low score came from a
**different limiter** — `size_gate` limits 43% of served spots vs `swell_exposure` 28.5%.
**Re-measure that one spot-hour live before acting on row 1.**

⇒ **AND ROW 2's "ACCUMULATION-GATED" LABEL IS WRONG.** The running ERA5 campaign banks **SIZE**
climatology (histogram, Tp/Tm, reference) which feeds the size gate (row 7) — *not* directional
exposure. `SWELL_SPREAD_EXPONENT_S` is registered **"NOT WIRED — research script only"**. The probe
fetches its own ERA5 per spot and needs no campaign. That row was waiting on something that was
never going to produce its input.

---

## §2 WHAT SHIPPED (this session's commits, oldest first)

| commit | what |
|---|---|
| `10cb61c3` | E2E: the suite mocked its own backend into 404 |
| `1d8277ff` `3445767b` | E2E: load-gate 15→45 s; **WebGL capability probe**, not a browser-name skip |
| `bcdcfebd` `95e3bb14` `1e00bbcc` `5c6d7c9f` | **CI estate lane** — 244 unclaimed test files, partition-asserted, floor from the gate's own run |
| `d9e1ffd3` | sim: window scan publishes why it ranked + the height caveat |
| `3f340a8c` | slope census re-measured under the shipped γ ceiling (4.1% → 100% saturation at Tp≥14) |
| `fec58f67` `054aa4b4` | **MASTER-AUDIT 7.0 + 8.0** (external SOTA comparison) |
| `3a95f9a1` | **`waef` ensemble wired** — priced, gated, byte-identical when off |
| `1b1c2900` `f1bd00bd` | sim: disclosure reached 1 of 4 renderers → **enumeration guard** |

**E2E arc: 8 hard failures → 1** (`46 passed / 1 skipped / 1 failed`), and the 1 skipped is the
WebGL probe working as designed.

---

## §3 STATE AT HANDOFF

* `origin/dev` was `f1bd00bd` (mine); the other session has since pushed `4b146165`. **Re-check.**
* **ERA5 campaign healthy** — marker `110/150` at 12:58:53Z, ~21–29 min/spot (NOT the ~5 min of the
  early batch; an 18-min gap is normal and I raised a false alarm on exactly that). ~40 left ≈ 15 h.
* **Live product, n=200, frame 04:00Z, GFS, precomputed:** geometry full 123 / **degraded 76 =
  38.0%** / blind 1 — unchanged from 08-03. Limiter `size_gate` 86 · `swell_exposure` 57 (28.5%).
  `directional_conflict` 54/200 = **27.0%**. Score max **exactly 69.9**, zero ≥70. `confirmed` 0.5%.
* Memory index compacted 20,449 → 17,680 B by retiring four whole topics; all files kept.
* Working tree carries only runtime `forecast_cache/*.json` and another session's
  `geometry_backfill.*` — **not mine, stage by path.**

---

## §4 THE QUEUE

1. ⛔⛔⛔ **Unfreeze the production frontend [OWNER].** `main--rawsurf` builds fine with a working
   `/api` proxy; production serves `3bd38a83` (2026-05-20) with 6/6 `/api/*` 404, and that SHA is
   the tip of **no branch** ⇒ locked/pinned deploy or auto-publish off. One dashboard screen.
2. **Exposure cliff / dual floor** — **NOT campaign-gated** (§1). Next step is the live re-measure
   of the Arugam frame, then decide whether row 1's root is exposure or `size_gate`.
3. **Ensemble — READY TO BUILD.** `swh` 10 members = **8.1 MB/step** (50 = 40.7; whole step = 501 MB,
   never fetch it). Request layer + spread reducer shipped, kill-switched OFF.
   ⛔ **NOT yet wired: the decode loop is not keyed by member** (`by[rid][kind][vt]` would have
   members overwrite) and no spread reaches a served product. Next: decode one member against a
   known field **on Linux**.
4. **38% degraded geometry** — unchanged over three days. Shore normal dominates (7.4/28.1).
5. ~~EWAM 5 km~~ ✅ **CLOSED NO-GO** — 324 cells/13 buoys: GFS MAE 0.210 beats EWAM 0.306 (+46%),
   GFS best at 8/13. **GWAM — our ICON-marine lane — best at ZERO of 13.** Worth a wider census.
6–7. Vercel · `RATING_LOCAL_SIZE` — **OWNER**.
8. Bed slope — measured negligible (0.0% of spots move at Tp≥14).
9. ✅ WebSocket hang — fixed by the other session (`7d0f4345`); quarantine lifted 2→1.
10. **`booking-flow.spec.js:99`** — `close-spothub-btn` not found, 3/3 attempts, while
    `toHaveURL(/spot-hub/)` PASSES. The selector **does exist** (`SpotHub.js:339`) and is
    unconditional inside the hero ⇒ the hub rendered without its spot data. Log shows
    `/api/profiles/test-surfer-id 404` — the stub user isn't real. **Not a missing selector.**

---

## §5 ⛔ WHAT NOT TO REDO

* **"EWAM 5 km will beat GFS."** My own Audit-7.0 proposal, killed by my own skill run.
* **"AIFS produces no waves."** Refuted (arXiv:2604.25559). Closed on **availability**, which expires.
* **"The exposure floor eats Arugam's good days."** Refuted (§1).
* **"Item 2 is gated on the ERA5 campaign."** The campaign banks size, not direction.
* **"The γ ceiling makes the slope term inert."** True at Tp≥14, false at 5–8 s.
* **"The E2E backend is failing."** The suite's own `page.route` allowlist manufactured the 404.

---

## §6 MISTAKES THIS SESSION, AND THE RULES THEY EARNED

* **I raised a false alarm that the ERA5 campaign had died** — applied a stale ~5 min/spot rate to a
  21–29 min regime, and stated it before checking. ⇒ **a rate is a measurement, not a constant.**
* **`schtasks` returned 0 tasks** and I nearly concluded "no scheduler exists"; PowerShell showed
  **216**. ⇒ **an instrument returning zero for everything is broken, not informative.**
* **Read GRIB `E` as two's complement** (−32756) when GRIB2 uses **sign-magnitude** (−12). The tell
  was that the number was physically absurd. ⇒ **a scale factor that is not small is a parse bug.**
* **Inferred "never run" from a missing `__pycache__`** — a `__main__` script never caches itself.
* **Routed off a memory's `description` without reading its body**, which had superseded it weeks
  earlier. ⇒ **when you supersede something in a body, rewrite the description in the same edit.**
* **My refactor nearly disarmed my own new guard** (moving a dict out left one needle reference).
  Verified rather than assumed. ⇒ **re-run a guard after refactoring the thing it guards.**
* ★★★ **"HIGHER RESOLUTION" IS A HYPOTHESIS, NEVER A REASON** — twice now.
* ★★★ **A CENSUS IS PINNED TO THE CONSTANT IT WAS TAKEN UNDER.**
* ★★★ **A DISTRIBUTION GAP IS NOT A CAPABILITY GAP.**
* ★★★ **CHECK EVERY CONSUMER OF A DISCLOSURE** — I wrote that in `d9e1ffd3` and then checked one of
  four. The fix for a thrice-repeated class is an **enumeration guard**, not a fourth patch.
* ★★★ **TWO DISCLOSURES WITH DIFFERENT TRIGGER PREDICATES ARE NOT COVERAGE FOR EACH OTHER**
  (`exposure_floored` fired on the LOSER while the WINNER's 1.75× went unsaid).
