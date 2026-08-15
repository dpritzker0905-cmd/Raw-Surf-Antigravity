# CURRENT HANDOFF — Program 13.0

**Written so a fresh session can continue WITHOUT rereading the 12+ audits.**

| | |
|---|---|
| **Date** | 2026-08-15 |
| **Branch** | `dev` — **all work PUSHED, CI green (11/11 jobs)** |
| **Baseline / rollback point** | `1f4e5149` |
| **End** | `b292e243` |
| **Scope** | 7 missions + a self-audit + a Gate 1 truth pass + SOTA research |

⚠️ **A CONCURRENT SESSION SHARES THIS WORKING TREE.** At handoff it had **uncommitted** edits to
`surf_transform.py`, `surf_height_convention.py`, `test_surf_height_convention.py`,
`routes/admin/surf_forecast.py`, plus an untracked `test_surf_cap_seam_monotone.py`. **Not mine — do
not stage, commit or revert them.** Always `git commit -o <paths>`; nothing isolates a push, and my
HEAD moved twice today without my running a command.

---

## 0. If you read one thing

> **Do NOT build the instrument inventory. I recommended it, then measured, and the measurement
> retired my own recommendation.**

`STATE_OF_THE_ART_PATH.md` names *"an instrument's output has a NAMED READER"* as the #1 gap, with
means *"a generated instrument inventory; a digest that fails when an instrument is red or empty."*
Before building it I ran the census it prescribes. **All 27 workflows, statuses and cron flags, in
ONE command** (`gh run list` per workflow + a `schedule:` grep). Seconds.

| finding | |
|---|---|
| **Nothing is red** — every completed run reads `success` | the digest would fire **zero** times today |
| `marine-nightly`, the lane that stood RED 18 of 37 runs | **green**, 2026-08-14 |
| **`python-upgrade-readiness` has NEVER RUN** (`— null`) | ⚠️ and carries **6 × `continue-on-error: true`** |
| `build-bathymetry` 06-29 · `l2-orphan-sweep` 07-08 · `build-shore-normals` 07-28 | stale **by design** — `workflow_dispatch` only |

**Two measured conclusions:**

1. **A checked-in inventory artifact is unnecessary and would rot.** The data is already generated
   and queryable on demand. A static list is precisely the hand-maintained census this program keeps
   getting bitten by (`WS-CAN-0066`'s alert guard, my own fixture census, `_RATING_SURFACES`). If a
   digest is ever built it must **generate** its subject list, never carry one.
2. **The digest is not urgent.** Building a detector for a condition that is not occurring is the
   "novelty is not authorization" trap (§33). Its value is catching the *next* red; the estate is
   green today.

⇒ **The one actionable item the census produced: `python-upgrade-readiness` — a workflow that has
never executed, whose 6 `continue-on-error: true` flags mean it could not fail if it did.** That is
the "a refusal you cannot read is a pass" class. Small and real — not a platform programme.

---

## 1. What shipped — 15 commits, pushed, CI green

| commit | what | reaches |
|---|---|---|
| `d8c866bd` | **WS-OBJ-207 / WS-CAN-0062** — a verified pin on BLIND geometry read "high conf" and said nothing | backend, live |
| `3afaf8b1` | **WS-OBJ-401** — split `spot_ratings.py` 800→351 at the LOC ceiling; lane → `spot_ratings_precompute.py` | enabler |
| `d1fb5369` | **WS-OBJ-103 / WS-CAN-0009** — 9 sites answered 200 with an error body, 4 leaking `str(e)` | backend, live |
| `a6e4339a` `9e9b8646` `c1566c8b` | **WS-OBJ-304 / WS-CAN-0017** — a Range request answered with the WHOLE FILE was accepted, then mapped positionally; + kill switch | backend, live |
| `6df51b03` | **Gate 1 truth pass** — 13 objectives measured against their own criteria; 3 mis-stated | governance |
| `4950ac45` `e5c68c1a` `cd995e40` `1cf2c49c` | latency forensics + a retraction; WS-CAN-0033 closed on evidence | no code, by design |
| `4b281e11` | state-of-the-art research | governance |
| `5fcdd817` `b292e243` | estate floor 396→386; L-2 answered | CI fix |

**Objectives:** WS-OBJ-207 **certified** · WS-OBJ-201 **re-certified** with the consumer list 12.2
required · WS-OBJ-203 / 205 / 506 blockers corrected — all **stale**, i.e. further along than recorded.

---

## 2. Five things that will cost you an hour each

1. **⚠️ SET THE ESTATE FLOOR FROM THE CI READING, NEVER A LOCAL ONE.** A local run of that lane is
   structurally **~10 higher**: `test_trevec_index_gc.py` does a module-level `importorskip` on
   `pyarrow`+`lance`, which a dev box has and CI installs from **neither** requirements file, so its
   10 cases never collect and 1 skip stands in. I set two raises from local runs and reddened CI.
   guards and chain carry no such bias. **2 of the 12-case gap remain unexplained.**
2. **Local browser verification of a backend change is a TRAP** — `useSpotRatings.js:299` hits the
   Supabase CDN (production precompute) first, and `BACKEND_URL` points at production. Both
   overrides: `BLOCKERS_AND_DECISIONS.md` D-3.
3. **A new `os.environ.get` in a rating surface is a REGISTRY EDIT** (`_RATING_FLAGS`). 155 targeted
   tests stayed green; only the full guards lane caught it.
4. **The lane that owns your NEW file is not the lane that owns the files you EDITED.** I re-ran only
   estate after editing 5 guards-lane files, and committed a red lane.
5. **Use the Editor, not string templating, on source.** Two self-inflicted breaks: a helper inserted
   at column 0 inside a function (valid Python, silently truncated a fixture), and an f-string
   mangled into a SyntaxError across all three fetchers.

---

## 3. Best path forward, in order

1. **`python-upgrade-readiness`** — never executed, 6 × `continue-on-error: true`. Make it run or
   retire it. The only item today's census produced.
2. **The other half of L-2 (not mine)** — the Calibration Census raises `SystemExit` with a *string*
   (exit 1 = NO-GO) when its spot fetch 503s, so a fetch failure pages as a calibration verdict. The
   workflow already has the right branch; the one-line fix (`exit 2`) is named in that entry.
3. **`WS-CAN-0017`'s remaining links** — end-to-end checksum, re-validation on restore. Backend,
   Gate 1, forensics already done.
4. **`WS-CAN-0029`** (freshness_sec) — the only other Gate 1 backend item that is a defined *Repair*.

**⛔ Do not build the instrument digest** (§0). **⛔ Do not start** Tier-3 research
(`WS-CAN-0046`–`0051`), `WS-CAN-0058` (audit-deferred), or any flag flip.

**The bottleneck is not engineering.** Gate 1 has 14 objectives: 2 certified, **4 owner-gated**
(`WS-CAN-0005`'s staged plan; the accuracy gate arms 08-22), 2 audit-deferred, the rest frontend-frozen
behind **`WS-CAN-0039`** — which multiplies 17 of 44 open task-rows by ~0.15. **Unfreezing the
production frontend is the largest single derivative on the board and only the owner can pull it.**
`dev → main` PR **#8** is open and now contains this work.

---

## 4. Work that must remain untouched

- ⛔ **The concurrent session's uncommitted files** (top of this document).
- ⛔ `backend/uploads/forecast_cache/marine_global.json` / `wind_global.json` — dirty since baseline,
  **not mine**, never staged. Verify they stay unstaged after any commit.
- ⛔ Do not weaken `test_flag_lane_parity`'s `>= 27` coverage floor — shrink-only by contract.
- ⛔ Do not couple `confidence` to `geometry_readiness` (D-1); a named CONTROL test enforces it.
- ⛔ Do not raise `SPOT_RATINGS_CONCURRENCY` — one var, two route semaphores, 1 CPU. And raising it
  is **refuted**: a warm A/B showed the concurrency shape does not move throughput.
- ⛔ `git commit -o <paths>` only. **Every push to `dev` is a production backend deploy.**
- ⚠️ `GRIB_RANGE_STRICT=0` disables the new range-integrity check without a deploy, if ingest ever
  breaks on it. Verified against live NOAA, but production egresses through Render.

---

## 5. Honest accounting

- **63% of this session's output was documentation**; ~198 lines of genuinely new production code.
- **Nine instrument errors of my own**, all caught — five by pairing a scan with a control or a second
  method, **none** by re-reading my own code. Full list: `SESSION_AUDIT_2026-08-14.md`.
- **Three conclusions retracted before they became actions**: raising `SPOT_RATINGS_CONCURRENCY`
  (refuted by a warm A/B), the WS-CAN-0064 "blocked on an admin read" claim, and the batch-omission
  design (caught by a pre-existing guard).
- **The recurring lesson, now measured four separate times:** an instrument that exists and is unread
  is this system's dominant defect shape — `/api/health`'s 41-route telemetry, `geometryReadiness`,
  `resolution`, and today's workflow census. ★ And the fourth one retired a build I had recommended.
