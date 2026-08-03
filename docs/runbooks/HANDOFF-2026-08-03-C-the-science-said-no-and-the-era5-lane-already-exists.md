# HANDOFF 2026-08-03 (C) — the science said NO, and the ERA5 lane already exists

**Range:** `66408b9f → 02499122`. **Supersedes** `HANDOFF-2026-08-03-B` on one point (§3).
**Read first:** `standing-work-rules-user-mandate.md` · `THE-SOTA-LEDGER-…` ·
`reading-the-marine-diagnostic-rings-2026-08-03.md`.

---

## §1 THE OFFSHORE KNEE — researched, and the change was CANCELLED

The owner asked to follow the best research rather than his word or my hypothesis. Done, and it
**reversed my own proposal from one commit earlier.**

Primary source — Scarfe, Elwany, Mead & Black, *The Science of Surfing Waves and Surfing Breaks — A
Review* (escholarship `qt6h72j1fz`, PDF fetched and text-extracted). The paper uses "wind" six times;
these are the only substantive statements:

> *"Offshore winds increase breaking intensity, and onshore or cross-shore winds lower it."*
> *"The perfect wind conditions for surfing are light offshore."*
> *"Strong offshore winds make waves hard to catch."*

**It gives the SHAPE and no threshold** — peak at *light*, decline once *strong*. It never names a
speed. Practitioner guidance puts "light" at **5–10 km/h = 2.7–5.4 kt**, and the 17–22 kt figure
marks where offshore turns actively *bad*, not where it stops being ideal.

⇒ **The engine already implements exactly that**: `wind_quality` is 1.0 offshore to **4 kt** — the
top of the ideal band, not inside it as I claimed — then declines monotonically (0.909 at 8 kt,
0.636 at 20 kt, 0.409 at 30 kt). **NO CHANGE. Lever 4 is struck.**

★ The owner's domain statement was **correct and already encoded**. Verifying it cost one PDF
extraction and *removed* a change that would have inflated every offshore day by up to a full level
on no evidence.

## §2 THE READER NOW RUNS (`02499122`)

`96dc9165` shipped the ring reader with **zero call sites** — the same shape as the arbiter that
reproduces the guard chain on 3000/3000 fixtures and decides nothing. Now wired:
self-installs `__RAW_RING_REPORT__()`, and `ringReaderTick` is called from the marine fetch path.

**It must not become the disease it detects**, so: silent on pass · at most one warn per 60 s and
only when the failing set changes · never writes to a ring · **the clock gate runs BEFORE the
capture** (walking ~750 entries on every call would make it unsafe from a hot path).

Its own healthy-window guard caught a design flaw of mine: **C4 FAILED on an absent key**, so a fresh
page would have accused on every load — which is how a monitor gets muted. Absence is *"not sampled
yet"*, not *"broken"*. Now it refuses, matching C2.

**5/5 mutations caught.** One survived at first — removing the early gate leaves the inner gate
holding, so the log stays quiet while every call still walks the rings: a **cost** regression a
warn-count assertion cannot see. Added a test that counts ring **accesses** via a getter. Full suite
**185 suites / 1725 tests / 0 failed**.

---

## §3 ⛔ CORRECTION TO HANDOFF B — THE ERA5 LANE IS ALREADY BUILT

Handoff B stated: *"The study is written. It is NOT wired in."* **That is wrong. I asserted it
without grepping for the script.** (My 8th wrong claim this session, and the first one caught by a
grep rather than a measurement.)

**`backend/scripts/era5_deepen_climatology.py` exists — v3, and it is complete:**

- `reanalysis-era5-single-levels-timeseries` returns a spot's **full hourly history 1979→present —
  416,952 rows, ~32 s, ~8 MB, in ONE request** (measured 2026-07-30 with a live CDS token).
- It carries Hs (`swh`), mean period (`mwp`) and direction (`mwd`) but **not peak period**, and mwp
  reads low vs the surf-relevant peak (5.6 vs ~7.9 s at Sebastian) — the same mean-vs-peak defect
  class the OM backfill's v2 fixed.
- v3 composes **47 years of (Hs, Tm, dir) × the spot's own measured Tp≈r·Tm calibration** from a tiny
  gridded pull, then puts **every sample through the production `resolve_surf_geometry` +
  `estimate_surf_at` chain** and takes the percentile on the TRANSFORMED distribution — the
  composition mandate honoured.
- Output merges into the same rolling-histogram blob (`spot_ratings/size_climatology.json`).
- `python scripts/era5_deepen_climatology.py --all --upload` — **~1–2 min/spot**.

### What is actually missing

| precondition | state |
|---|---|
| the script | **built (v3)** |
| `xarray`, `netCDF4` | in `requirements.txt` |
| **`cdsapi`** | **NOT in `requirements.txt`** |
| **CDS token (`~/.cdsapirc`)** | **NOT present** — `backend/.env` has only `COPERNICUSMARINE_*` (CMEMS marine), which is a *different* service |
| **the campaign having been RUN at scale** | **NOT ESTABLISHED — I did not verify this and it is the first thing to check** |

⚠️ Note it is **47 years (1979→)**, not 85. The 1940 figure in the study is the *gridded* ERA5
product; the per-spot timeseries lane starts 1979. Still 12 years more than Surfline's 35.

⇒ **"Wire the 85 years in" is not a build task. It is an ops task: a CDS token, `cdsapi` in
requirements, and a campaign run.** That is a materially smaller and better-defined job than
handoff B implied.

---

## §4 THE QUEUE

### Tier 1 — the linchpin, now correctly scoped
1. **Check whether the ERA5 campaign has run.** `load_size_climatology_l2_cached()` / the admin
   blob view reports `updated_at` and per-spot depth. A spot backed by ~400k samples means ERA5 ran;
   a few hundred means it is still our own forecasts. **Do this before anything else — it decides
   whether the rest of Tier 1 exists.**
2. **If it has not run:** add `cdsapi` to requirements, provision a CDS token, then
   `era5_deepen_climatology.py --all --upload`. Guard: `local_size_gonogo.py` exists specifically to
   say GO/NO-GO before flipping, and the **owner anchor suite is the acceptance test**.
3. **Then re-derive the bucket boundaries as percentiles, and only then add `very_good`.** The
   implementation is known-good and reverted — see `HANDOFF-…-B` §3 for every surface and why the
   bisection at 77 was rejected (it inflated an 8 s windswell from `good` to `very_good` on a
   midpoint, not a derivation).

### Tier 2
4. **`clamp_resharpen`** — 19 of 34 detaches (56%), the named committer behind the heatmap thrash.
5. **Mask rebuild thrash** — 20 rebuilds alternating 2048↔4096. ⚠️ **five recorded false fixes;
   needs eyes on the map.**
6. **Flavor cache 63% miss** — `flavor_fastpath_miss` 31 vs `flavor_cache_fastpath` 18. Untouched.

### Tier 3
7. `is_dynamic_viewport_product` threading (the real hit/miss signal) · 8. the unfound bbox inflation
rule · 9. **the skill score against instruments — still the only thing that makes any of this
falsifiable** · 10. the conjunction · 11. v5 F7/F8 · 12. `surf_rating.py` at **760/800 LOC**.

### ⛔ STRUCK — do not re-propose without new evidence
arbiter A/B (`arb_shadow_diverge: 0`) · react-scan (`reactRerenderCounter: 0`) · no-downgrade as the
thrash cause (3 of 32 commits) · bounds-based `coverage` · `CAP_UNCONFIRMED` as the ceiling
(circular — no model reaches 70) · the exposure floor as a defect · `_REF_ANCHOR_SCORE` as a lever
(0.05 headroom, changes no level) · **the offshore knee (§1)**.

---

## §5 PROCESS

**Eight wrong claims this session, every one caught before it shipped.** The newest two are the most
instructive because they failed *differently*:

- **The offshore knee** — caught by going to the **primary source** instead of the search summary.
  The peer-reviewed paper supported the code and contradicted me.
- **"ERA5 is not wired in"** — caught by a **grep**. I had asserted absence without looking, which is
  the cheapest possible check and I skipped it.

⇒ New standing rule: **absence is a claim and needs evidence too.** "X does not exist" costs one
grep and I spent an hour of handoff on the assumption instead.

Existing rules that earned their keep today: *the known-good control is what saves you* (it voided
`bathymetry.depth_at` as a land test) · *ask the server what it is running* · *a field is not shipped
until a test asserts it survives serialisation* · *a consumer nobody calls is the disease*.
