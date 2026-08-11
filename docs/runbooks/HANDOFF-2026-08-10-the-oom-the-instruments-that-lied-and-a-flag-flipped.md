# HANDOFF 2026-08-10 — the OOM, the instruments that lied, and a flag flipped

**Branch:** `dev` · **Owner-visible outcome:** the serve box went from OOM-killing itself 7 times
in 15 hours to **38.8% of its memory cap with 1,253 MB of headroom**, and the map's default-state
wave height stopped being silently under-read by a median 3x.

⚠️ A **concurrent session** worked this tree throughout. Everything below was staged BY PATH.

---

## §0 READ THIS FIRST — the two things that will bite the next context

1. ⛔⛔ **A RENDER ENV VAR IS INERT UNTIL A DEPLOY.** `PUT /v1/services/{id}/env-vars/{KEY}` returns
   200, the read-back shows the new value, and **the running process keeps the old one**. No deploy
   is triggered. `POST /v1/services/{id}/deploys {"clearCache":"do_not_clear"}` then verify against
   the PROCESS — `/api/health`, or the code's own log line — never against the config. This is the
   same shape as the 08-03 `PREFETCH_MAX` prescription sitting unapplied for seven days.

2. ⭐⭐⭐ **MATCH THE LOAD, NOT THE CLOCK.** Every memory comparison in this session was confounded
   until I drove the box to a matched `disk_product_count`. RSS here climbs with *products loaded*,
   not with uptime, so `uptime` is not a control. I published a "−62%" that was a quiet box at 8
   minutes against a busy box at 23. Retracted. The only memory figure in this handoff I would
   defend is the matched-disk one in §2.

---

## §1 THE OOM — root cause, measured end to end

| link | measured |
|---|---|
| cgroup limit | 2,048 MB (standard plan, 1 uvicorn worker) |
| baseline plateau | 1,650–1,706 MB, flat 70 min before the kill |
| headroom | ~350 MB |
| **one global-bbox 48h `grid_series`** | **+170.3 MB RSS, 6.67 MB on the wire — 25x amplification** |
| RSS decay, 150 s total idle | **zero**, to the decimal, 6 polls |
| client pages per settle | 3 → 3 × 170 > 350 ⇒ OOM |
| oomKilled events | **7 in 15 h** |

★★★ **THE WIRE IS NOT THE COST.** Never price a serve endpoint by payload size; measure RSS across
the call.

**Why the existing guard missed it:** `apply_vector_budget` runs on the ASSEMBLED response while
`asyncio.gather` holds every hour's full product alive — `CONCURRENCY` bounds resolution, never
RETENTION. ~390,000 `GridVector` models were materialised and 8-in-9 discarded. ★★★ **A BUDGET
APPLIED AFTER ASSEMBLY IS A TRANSFER BUDGET, NEVER A MEMORY ONE. Ask WHERE a guard runs.**

✅ **Fixed `0d9149b7`** — decimate each hour AS IT LANDS with the stride the end-stage bound would
have chosen. **Proven in production: the identical request went +170.3 MB → +0.0 MB**, serving
**35 frames instead of 26** in 26.3 s instead of 29.3 s.

**Killed by measurement** (do not re-propose without new numbers): the product cache (+551 products
landed, RSS unmoved to the decimal); the manifest (19,496 `ManifestProduct` = **91 MB**, measured
with the repo's own schema); the 08-03 "boot spike" attribution (this OOM came **9 h** after deploy).

---

## §2 THE CONFIG HALF — the number I would defend

Both Render knobs set **one at a time**, each with its own measurement.

**`PREFETCH_MAX=120` + `PREFETCH_CONCURRENCY=2`** — verified by the prefetcher's own log, not RSS:
`Capping warm set 3826 -> 400 ... conc=5` (26 s) became `3826 -> 120 ... conc=2` (**10 s**).

**`MALLOC_TRIM_THRESHOLD_=131072`** — glibc auto-RAISES its trim threshold as a program frees large
blocks, which is why RSS never returned. Pinning it at the documented 128 KB disables that.
**Measured at MATCHED `disk_product_count`, by driving the box there deliberately:**

| | disk | RSS | % of 2,048 |
|---|---:|---:|---:|
| pre-trim | 590 | **1,445.3 MB** | 71.2% |
| post-trim (probe) | 554 | **784.0 MB** | 38.3% |
| post-trim (loader, independent series) | 582 | **794.8 MB** | 38.8% |

**≈ −650 MB at the same product count**, two independent series. ⭐ RSS repeatedly sits BELOW peak
mid-flight (752.5 vs 768.3) — memory actually returned, which had **never** been observed here.

⚠️ **A latency concern I raised and then WITHDREW.** The loader's `grid` p90 of 3,385 ms was COLD
PRODUCT FETCHES — that *was* the loading work. A concurrent probe sampled the warm path in the same
window: `spot-ratings` median **~385 ms under load** vs a **268–357 ms idle** baseline. No clear
regression. ⚠️ Tail not settled — "nothing supports a regression", not "proven equal".

⛔ **`MALLOC_ARENA_MAX` deliberately LEFT UNSET.** There is no longer a memory problem to justify
moving a second allocator variable. Each knob reverts with one env var.

---

## §3 THE HEIGHT FLAG — flipped, and my first verdict was wrong

`679da3d9` flips `__RAW_NEARSHORE_RENORM__` ON (owner decision). Kill switch `= false` restores the
old behaviour exactly, pinned to the same three constants (0.975 / 0.450 / 0.175).

**Measured on real production data** — a live GFS grid for Florida (40% land cells) at the 93 real
spots inside it, through the shipped sampler: **80/93 (86%) move**; ratio **p50 3.00x, max 10.68x**;
**ON == the period lane's own sample at 80/80 movers**.

⛔⛔ **I FIRST RECOMMENDED AGAINST FLIPPING IT.** A 423-resolution census showed the exact-point
lane answering 100%, so I called the tile lane unreachable. That measured whether the point
ENDPOINT can answer — not whether it is the AUTHORITY. `isExactPointAuthority` requires
`selectedSpot || longPressLocation`, while the overlay renders whenever any layer is active
(`MapPage.js:585`, whose second clause is tautological). **In the default map state the decayed
tile value is displayed directly.** ★★★ **A NETWORK CENSUS CANNOT ANSWER A QUESTION WHOSE GATE IS
CLIENT RENDER STATE.**

⛔ **Proven: internal consistency** + removal of a client-side height transform CLAUDE.md forbids.
**Not proven: accuracy.** No buoy validates this sampler; the skill ledger scores the BACKEND point
lane. If heights now read high, revert is one flag.

---

## §4 THE SKILL LEDGER — a false alarm of mine, and the real gap

⛔ **"We are losing to persistence" was MY FALSE ALARM.** `skill_summary` groups each source
independently, so reading DOWN its MAE column compares different populations: `raw_surf` over 64
target times against `persistence` over **7** (persistence only scores buoys with a live obs).
**Paired on identical keys the verdict INVERTS: 0.186 vs 0.203 — we WIN.**
✅ Fixed `60f724d0`: `head_to_head()` publishes the paired comparison with `n_ours_total` /
`n_theirs_total` beside `n_paired`; the divergence flag fires on exactly the row that fooled me.
⇒ Two more of my claims died with it: `raw_surf` is **GFS through our chain, not a blend**, and the
EURO gap is **+0.014**, not 0.055.

✅ **What survives, and is the real target:** Open-Meteo beats us at every lead, paired, n=844/853/716.
`1140b3e4` adds `open_meteo:ncep_gfswave025` — the SAME model, fetched by someone else — because the
existing lane sends **no `models=`** and therefore compares our GFS against their `best_match`
blend. **OM-GFS ≈ ours ⇒ model choice. OM-GFS > ours ⇒ our chain.** Needs scored rows; ~1–2 days.
⚠️ Two traps caught live: an invalid `models=` returns **HTTP 200 + a JSON error object** (zero rows,
silently, forever — now raises), and **`0.0` is a coverage hole, not a flat sea** (our lane always
dropped it; the OM lanes did not).

---

## §5 CI / ACTIONS

✅ **`c7099d0a`/`6e5bf70a`** — 340 of 482 backend test files were selected by **no CI lane**,
including every guard on the box's memory bounds *and the OOM fix's own new guards*. Named family
added (141 files). ⚠️ The composition list exists **TWICE** in `ci.yml` — the `ls` selector and the
`COMPOSITION` literal — and editing one gives double-counting or dark tests depending which.
✅ **`00dfba86`** — E2E fired on **markdown-only commits** (9 of 30 runs) and, with
`cancel-in-progress`, a docs push KILLED the in-flight run of the code commit before it: **eight
consecutive cancelled runs, zero coverage**. `paths-ignore` added. ⛔ `cancel-in-progress: false` is
the WRONG fix and is now pinned against: this lane tests the **live deployment**, so a superseded
run would report another commit's deployment under this commit's SHA.
✅ Render build filter set (`ignoredPaths: docs/**, audit/**, **/*.md`) — a single markdown commit
was redeploying production. Both directions tested: docs → no deploy; `render.yaml` → deploy.
⚠️ **`render.yaml` is NOT APPLIED to this service** (3 independent tells). Its `RATING_TIDE=1` was
therefore never on the serve box → set via API, `1270816b` era, closing a documented lane split.

---

## §6 STILL OPEN

* **Open-Meteo control lane** — needs scored rows (~1–2 days) to answer model-choice vs our-chain.
* **Credential rotation** — the master report says **two** live credentials in `BRAIN_RULES.md`
  (Supermemory + Qdrant), not the one JWT I found. Owner action; history retains them.
* **333 backend test files** still in no CI lane (I fixed only the memory family).
* **The pixel oracle** — `weather-simulation.spec.js` still 1 `test.fixme` + 6 `test.skip`.
* **R11 action 1**, the external uptime probe, scored **P0 in the report's own table**, still open.
* **Three dark flags** besides the height one still await an A/B (`874ad925`, `37654183`, +1).
* **Height accuracy** — the flag is consistent, not validated. No buoy scores that sampler.

---

## §7 MY OWN ERRORS — the useful half

1. ⛔ **I pushed `c7099d0a` red** while the local run that would have blocked it was still going.
   The reasoning (CI is authoritative; my interpreter is flagged non-declared) was sound and the
   call was still wrong: the run covered the file I changed and returned red 17 minutes later.
2. ⛔ **Three conclusions stated confidently and then reversed by a better measurement**: "we lose
   to persistence" (unpaired), "the tile lane is unreachable" (wrong gate), "the trim costs
   latency" (cold fetches). Each was caught, but only because something forced a second look.
3. ⛔ **A guard of mine was HOLLOW**: `"LIVE DEPLOYED" in src` survives anywhere in a 200-line file.
   `"x" in src` is never a real needle. Rewritten structurally, verified 2/2.
4. ⛔ **I read `rc=4` as CAUGHT.** That is pytest's COLLECTION ERROR — my mutation had broken the
   file's syntax, so the guard never ran. **Require the exact failure you intended (rc == 1).**
5. ⛔ **I read `exit code 0` off a `| tail` pipeline** and nearly called a SIGTERM'd suite green.
6. ⚠️ **Selector built on a mislabelled population**: hand-drawn "Mediterranean"/"Sea of Japan"
   boxes that contained Atlantic Biscay and Pacific-side Chiba, and 2 of 14 regions parsed.
7. ⚠️ **Windows/bash tax, four times**: `/tmp` differs between Git Bash and Windows Python; a
   `| head` pipe buffered a monitor to silence; cp1252 choked on `✓` in subprocess output; and
   `--testPathPattern=a|b` died `rc=255` because `npx.cmd` routes through `cmd.exe`, which ate the
   `|` as a shell pipe.
8. ⚠️ **I nearly re-fixed something already fixed** — my memory said the frontend suite carries
   `continue-on-error: true`; `ci.yml` records its removal on 08-01 with four verification runs.
   **Read the live config, including when the stale record is your own.**
