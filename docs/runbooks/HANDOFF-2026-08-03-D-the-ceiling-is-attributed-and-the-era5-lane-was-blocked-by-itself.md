# HANDOFF 2026-08-03 (D) — the ceiling is ATTRIBUTED, and the ERA5 lane was blocked by its own guard

**Range:** `c7bff7da → HEAD`. **Supersedes** handoff C on §3 (the ERA5 preconditions) and edits
ledger row #1 (the cap, and the `swell_exposure` floor).
**Read first:** `standing-work-rules-user-mandate.md` · `THE-SOTA-LEDGER-…` ·
`a-guard-that-matches-its-own-launcher-2026-08-03.md`.

---

## §1 THE CEILING IS ATTRIBUTED — 24% of the product sits on the `swell_exposure` FLOOR

`limiter` shipped in `6da4c16e` and survived the wire in `54304ad8`, and then **nothing read it** —
the disease this repo keeps re-catching. `scripts/limiter_histogram_census.py` is the consumer.

**Live, n=200, served frame 17:00Z:**

| limiter | count | median score | median factor | median score if that factor were 1.0 |
|---|---|---|---|---|
| `swell_exposure` | 79 | **4.3** | **0.10** | 37.0 |
| `size_gate` | 78 | 22.0 | 0.40 | 55.4 |
| `wind_period_blend` | 42 | 21.0 | 0.40 | 54.2 |
| `period_gate` | 1 | 8.0 | 0.40 | 22.0 |

⭐⭐⭐ **48 spots — 24% of the sample — sit at `swell_exposure == 0.10` EXACTLY.** Their median score
is **3.8** against **21.1** for everyone else. **35 of the 48 have `full` geometry**, so this is
*not* mainly the 38% degraded shore normals (ledger #2).

```
swell_exposure(swell_from, normal) = clamp(0.10 + 0.90 * max(0, cos Δθ))
```

Every bearing **≥90° off the normal returns the floor — an entire half-plane.** The floor was
recorded in the ledger as a *rare protective clamp*; it is the **operating point** for a quarter of
the product. This is a **straight-beach model**, and what it cannot express is the point/headland
break working on **wrapped, refracted** swell — which is most of the world's best surf.

**Named exemplars, all offshore wind, all scoring `very_poor`:**

| spot | conditions | score | geometry |
|---|---|---|---|
| **Arugam Bay Main Point** | 5.1 ft, 10 s, **15 kt offshore** | **3.9** | `full` |
| **Namotu Lefts** (Fiji) | 6.4 ft, 11 s, **16 kt offshore** | **4.4** | `full` |
| **Torquay / Bells** | 5.5 ft, 12 s, **16 kt offshore** | **4.0** | `degraded` |
| **Muroto** (Japan) | 6.7 ft, **14 s**, 13 kt offshore | **7.8** | `degraded` |

**The failing-instance measurement (rule 9, done BEFORE proposing any fix).** At Arugam the live
marine point is **226° @ 9.75 s** (swell_1 204° @ 9.87 s) against an east-facing normal ⇒ Δθ≈126°
⇒ floor, reproducing the engine exactly. **That swell IS Arugam's season** — May–September, SW
Southern-Ocean swell wrapping Sri Lanka's southern tip into the east-coast points. The engine floors
the spot on its defining condition.

⛔ **NO CONSTANT WAS TUNED, and none should be.** The ledger's own rule holds: the fix is not a
softer floor (that would inflate genuinely blocked coasts by the same 10×). The principled fix is an
**empirical per-spot directional exposure learned from the 47-year record** — which is exactly what
§2 unblocks.

## §2 THE ERA5 LANE — it was never a credential problem, and it now RUNS

Handoff C's precondition table was wrong on **both** blocking rows:

| precondition | handoff C said | measured |
|---|---|---|
| `~/.cdsapirc` | **absent** | **PRESENT since 2026-07-30** |
| `cdsapi` | **absent** | **imports fine** (only the `requirements` pin was missing) |
| campaign run at scale | not established | **still not run — but now possible** |

**THE ACTUAL BLOCKER.** `_another_instance_pid()` asked
`any(basename in part for part in proc.cmdline())` across every process. **A shell launching the
script necessarily carries the script's name in its own command line**, so
`bash -c "python scripts/era5_deepen_climatology.py --all --upload"` matched **itself** → *"another
ERA5 campaign is already running (pid \<the launching shell\>)"* → exit before the first fetch.
Every wrapper launch — `bash -c`, the nightly scheduled task, CI — self-aborted. **The guard did not
fail to run; it ran, and blocked the only thing it existed to protect.**

Fix (`4b28f750`): the argv **script slot**, not string shape — process must be a python interpreter
(kills the shell), name must sit in the first non-flag argument (`-c`/`-m` ⇒ no script), self **and
all ancestors** excluded.

**PROVEN END-TO-END — the first time this lane has ever run:**

```
Arugam Bay Main Point   139,016 samples  Tp/Tm=1.296 (n=2928)  reference=1.346 m  [69s]
Arugam Bay - Baby Point 139,016 samples  Tp/Tm=1.296 (n=2928)  reference=1.327 m  [84s]
```

47 years at 3-hourly stride, every sample through `resolve_surf_geometry` + `estimate_surf_at`.
**~78 s/spot, not the ~6 min the docstring predicted ⇒ the full 1,773-spot campaign is ~38 h.**

⚠️ `cdsapi` is pinned in **`requirements-dev.txt`, not `requirements.txt`**: the campaign is an
operator lane on a workstation, and the serve box that OOM-killed at 1,579 MB must not carry an SDK
it never calls.

## §3 THE OBSERVATION GATE — the cap is not inert, but AGREEMENT is the wall

⚠️ **"The cap is INERT" was measured at ONE HOUR and is wrong.** At 17:00Z **2 of 200 spots crossed
70 raw and both were capped to exactly 69.9** — Nai Harn 70.6, Twin Rocks 75.6.

⛔ **But the cap was CORRECT both times**, so it is still not the lever:

| spot | GFS | ICON | EURO | agreement |
|---|---|---|---|---|
| Nai Harn | **70.6** | 68.4 | 26.2 | 1-of-3 → capped |
| Twin Rocks | **75.6** | 45.8 | **3.0** | 1-of-3 → capped |

⭐⭐⭐ **`internal_confirmation` needs ≥2 models ≥70 at one spot-hour. Across two distinct frames
(17:00Z n=587 over 4 regions; 14:00Z n=200) `CONFIRMABLE` = 0 in BOTH.** Models *do* cross 70 —
GFS 75.6 at 17:00Z, **EURO 78.7** at 14:00Z — **never the same spot at the same hour.** Spread
p50 7.3 / p90 25.0 / **max 72.6**.

★ **The gate asks two models to independently clear the SAME threshold it withholds**, so
confirmation is strictly rarer than the event it gates. That is what the free 50-member ensemble
(ledger #3) is for: a spread *is* a confidence, and confidence is what the gate actually wants.

⚠️ **`/spot-ratings` collapses every request inside the 6 h stale window onto ONE frame.** My first
sweep reported "1174 spot-hours" that were **587 spots at one hour wearing a temporal costume**.
**Read `served_valid_time`, never the requested hour.** Distinct frames were 3 h apart (14:00, 17:00).

## §4 STRUCK / CORRECTED THIS SESSION

- ⛔ **"`cdsapi` and the CDS token are absent"** — both present. Rule 25 failing *inside the table
  that stated rule 25*.
- ⛔ **"`swell_exposure`'s floor is a rare protective clamp"** — it is the operating point for 24%.
- ⛔ **"The cap is inert"** — 2/200 capped at 17:00Z; the strike came from n=1 hour.
- ⛔ **"No model reaches 70 anywhere (GFS 40.6 · ICON 48.3 · EURO 48.0)"** — GFS 75.6, EURO 78.7.
- ⛔ **My own first fix to the guard** — killed by a mutation harness after 12 green tests passed it.

## §5 QUEUE

**Tier 1 — now correctly scoped**
1. **The directional exposure model.** Replace the cosine half-plane with a per-spot **empirical**
   exposure learned from the 47-year ERA5 record: for each swell-direction bin, what breaking height
   does this spot actually receive? Captures wrap/refraction/sheltering without modelling them.
   `scripts/directional_exposure_probe.py` is the measurement: for a spot's 47-year record it
   reports **what fraction of the BIGGEST decile of waves arrives from bearings the engine floors**.
   It ships with a **control spot** (an open beach whose exposure the cosine should get right) so it
   can come back *"the model is fine here"* — a probe that cannot exonerate is not evidence.
   ⚠️ **STATUS: written; its first run was still in flight at handoff time** (CDS queueing, ~70 s
   per spot fetch plus two 139k-sample transforms). **Do not reason from it until you have watched
   it execute** — running the last two new instruments found defects *in the instruments*.
2. **Run the campaign** — `era5_deepen_climatology.py --all --upload`, ~38 h, writes production L2
   and moves the size reference for every spot. **Operator decision**; gated by
   `scripts/local_size_gonogo.py` and the owner anchor suite.
3. **Then** re-derive bucket boundaries as percentiles, and only then add `very_good` (handoff B §3
   has the reverted, known-good implementation and why 77 was rejected).

**Tier 2** — `clamp_resharpen` (56% of detaches) · mask rebuild thrash (⚠️ five recorded false
fixes) · flavor cache 63% miss.
**Tier 3** — the skill score against instruments (still the only thing making any of this
falsifiable) · the conjunction · v5 F7/F8 · `surf_rating.py` at 760/800 LOC.

## §6 PROCESS

Every wrong claim this session was caught by a **control, a mutation, or a replicate** — never by
review, and never by a green suite:

- **The mutation harness killed my own fix** that 12 passing tests had just accepted
  (`posixpath.basename` splits a code blob on `/` exactly as it splits a path).
- **The replicate killed my own headline.** I wrote "ICON and EURO never cross 70"; the 14:00Z frame
  had EURO at 78.7. The claim that *survived* both frames — no two models ever agree at one
  spot-hour — is stronger and is the actual finding.
- **The live test failed correctly** because a real campaign was running: a guard for concurrency
  cannot be tested by asserting no concurrency exists.

⇒ Standing addition: **a "0 occurrences" reading from a single sample is not a strike.** Two of this
session's corrections were counts measured once and generalised.
