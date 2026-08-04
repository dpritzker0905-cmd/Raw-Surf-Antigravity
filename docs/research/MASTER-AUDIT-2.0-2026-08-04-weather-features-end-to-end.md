# MASTER AUDIT 2.0 — ALL WEATHER FEATURES, END TO END
**2026-08-04 · backend, database, data pipeline, frontend, live + preview sites, and the weather sim**

> Versioned 2.0 because `MASTER-AUDIT-1.0-2026-08-03-all-weather-features.md` already exists and was
> revised to 1.1 earlier today (`6151e854`). This does not replace it; it audits what 1.1 left open
> and adds the surfaces 1.1 did not reach (live map interaction, DB, the sim as a product).

---

## §0 METHOD, AND WHAT WOULD MAKE THIS REPORT WRONG

Every claim below is a live measurement with its n and its frame, or it is labelled a hypothesis.
Stated up front, because a finding without its limits is a liability:

* **Single-hour sampling.** Most population figures come from the served frames
  `2026-08-04T13:00Z / 15:00Z`. Where a number is one frame, it says so. The 08-04 morning handoff
  was refuted precisely by generalising one frame; that lesson is applied here.
* **`/spot-ratings` caps at `limit=200`** against ~1,773 spots, so any single bbox is a VIEWPORT
  sample. Population figures use a union of 5-8 regions (n=979 or n=30 spots x 12 lanes) and say which.
* **The browser pane backgrounds between tool calls**, so `requestAnimationFrame` throttles to ~0.
  `drawCallsPerFrame` read 0 for that reason, NOT because nothing renders. **No FPS, frame-time or
  paint claim is made in this report.** Everything browser-side is event-driven or state-read.
* **The deployed site could not be driven**: `dev--rawsurf.netlify.app/map` redirects to
  `/auth?tab=signup`. I did not create an account or enter credentials. Live-map findings come from
  the sanctioned local harness (`frontend-live` :3001, mock auth -> real Render data), which runs the
  same `dev` code the preview builds from.
* **ERA5 is not truth** (underestimates extremes 30-32%); it is used here only for distribution shape.

---

## §1 VERDICT

| surface | state | headline |
|---|---|---|
| Backend API | **healthy** | providers healthy, 0 stale products, 14,195 grid files / 148 MB |
| Database | **healthy** | 0 ERROR advisories; 135 INFO (deny-by-default RLS), 1 WARN |
| Data pipeline / ERA5 | **works, 7.3% covered** | 85-year history **verified wired end to end** |
| Marine data quality | ⛔ **defect** | EURO `wind_waves` serves physically impossible waves |
| Rating composition | ⛔⛔ **the big one** | height and quality contradict each other on ~1 spot in 5 |
| Weather sim | **works; inherits the above** | chain parity <1%; the numbers it reports disagree |
| Frontend map | **healthy** | toggles, zoom, scrub, a11y pattern all functional |
| Deployment | ⚠️ | production `main` is **104 commits / 2 days** behind `dev` |

---

## §2 ⛔⛔ CRITICAL #1 — ONE PHYSICAL QUANTITY, MODELLED TWICE, 5.95x APART

**This is the highest-leverage defect in the product and it is what makes the sim look broken.**

"How much of the swell is aimed at this coast" is computed in **two** places with **two different
floors**:

| chain | function | formula | floor | range |
|---|---|---|---|---|
| QUALITY | `surf_rating.swell_exposure` | `0.10 + 0.90*max(0,cos dtheta)` | **0.100** | 10x |
| HEIGHT | `surf_transform._height_exposure_factor` | `0.55 + 0.45*exposure` | **0.595** | 1.68x |

### Measured, by the sim's own what-if (everything held constant except direction)
Pipeline, 2026-08-04T14:00Z, real swell 1.469 m / 11.8 s:

| | dtheta = 130 deg (real) | dtheta = 0 deg (head-on) | ratio |
|---|---|---|---|
| breaking height | **4.4 ft** | 7.3 ft | **x1.66** |
| quality | **3.6** | 50.9 | **x14.1** |

The measured height ratio (1.66x) matches the height factor's own range (1.68x) — so the mechanism is
confirmed, not inferred.

### The user-visible consequence, on 4 of 4 world-class spots sampled
| spot | swell vs normal | served height | served quality |
|---|---|---|---|
| Pipeline | 95 deg vs 325 deg | 4.4 ft "Chest High" | **3.6/100 very_poor** |
| Laniakea | 99 deg vs 315 deg | 4.2 ft "Chest High" | **3.6/100 very_poor** |
| Honolua Bay | 67 deg vs 323 deg | 3.5 ft "Waist High" | **3.0/100 very_poor** |
| **Arugam Bay** | 216 deg vs 105 deg | **5.3 ft "Head High"** | **3.3/100 very_poor** |

Every one publishes `swell_alignment_pct: 10` **while its own height used 59.5%**. One payload states
both that the swell cannot reach the break and that it is breaking head-high.

### Which number is wrong — and it is the HEIGHT
In energy terms the height chain implies `0.595^2 = 0.354`; the quality chain says `0.10`. That is
the **3.5x disagreement** already recorded in memory, now demonstrated end to end. The spectral
science (`2d17dc41`, control verified: flux -> cos(dtheta) as s -> inf) puts the true onshore swell
flux at dtheta=100 deg at **0.013**. So:

* the quality floor (0.100) is already ~7.7x too generous;
* the height floor (0.354 in energy) is **~27x too generous**.

⇒ **The app over-reports breaking height at off-angle spots**, and ~18-21% of the served population
sits at or near that floor.

⛔ **DO NOT PATCH THE FLOOR DIRECTLY.** `HEIGHT-ACCURACY-two-errors-that-cancel-2026-07-30`: height is
currently correct *by cancellation*, and `SURF_HEIGHT_H110` must never be flipped alone (+25.5%).
Changing the exposure floor breaks the same cancellation. This is a **two-sided change requiring the
owner-anchor harness plus a directional harness that does not yet exist** — every existing anchor is
head-on, so a 47% height cut moves all five by exactly 0.0.

**Recommended sequencing:** (1) publish the contradiction rather than hide it — a spot whose
alignment is 10% should not print a confident "Head High"; (2) build the directional A/B harness;
(3) only then reconcile the two floors onto one function.

---

## §3 ⛔ CRITICAL #2 — EURO SERVES WAVES THAT CANNOT EXIST

Deep water: `L = 1.56 T^2`, and steepness `H/L` above **1/7** has already broken. A pair above that
limit is not a sea state; it is a broken field.

`scripts/wave_physics_validity_census.py`, n = 30 spots x 3 lanes x 4 layers = 360 samples:

| lane | impossible |
|---|---|
| GFS (4 layers) | **0 / 120** |
| ICON | **0 / 90** |
| **EURO `wind_waves`** | **10 / 30 = 33%** |

Examples: Nusa Dua **0.591 m at 1.00 s** (steepness 0.38, ~2.7x the limit); Alotau Reef 1.254 m at
1.43 s (0.39); Sloat Boulevard 1.044 m at 1.55 s (0.28).

### Attribution (primary source, not our own derived grid)
* **ECMWF WAM025 returns ALL NULLS at these coordinates** — EURO has no native data there.
* Open-Meteo `best_match` publishes short wind-wave periods **paired with small heights**
  (0.16 m at 1.85 s = steepness 0.03, perfectly physical). So short periods are normal;
  **our (H, T) pairs are internally inconsistent.**
* Provenance on the served point: `waves` -> `upstream_provider: ecmwf` (1.934 m / 14.78 s, fine);
  `wind_waves` -> `upstream_provider: **copernicus**` (0.591 m / 1.0 s, impossible).

⭐ **The EURO lane serves two different upstreams under one model label**, and the bad one ships
`is_estimated: false` with **no warnings** — a number that cannot exist, asserting it is
authoritative. This is the PROVENANCE class, again.

**Blast radius:** the `wind_waves` map layer for EURO (texture packs `period/20`, so 1.0 s renders at
0.05 instead of ~0.25), the infobox period, and — if `SURF_PARTITIONS` is ever flipped on —
`sea_cleanliness` and `dominant_swell_period` would be computed from it.

**Fix:** a steepness validity filter at ingest that REFUSES rather than serves, plus honest
`is_estimated`/`warnings` when the copernicus wind-wave channel is used.

---

## §4 ⚠️ CRITICAL #3 — THE MODELS DISAGREE BY 87 DEGREES AND WE PUBLISH ONE OF THEM

`scripts/lane_swell_direction_probe.py` (direction read straight off `/point`, so no shore-normal
assumption enters). Majestics, total `waves` field:

| lane | direction | height | period | swell_1 |
|---|---|---|---|---|
| GFS | 61.7 deg | 1.03 m | 13.0 s | 66 deg / 1.28 m / **15.4 s** |
| ICON | 78.6 deg | 1.15 m | 9.4 s | 84 deg / 1.24 m / 10.9 s |
| EURO | **149.0 deg** | 0.78 m | 9.7 s | 126 deg / **0.34 m** / 7.6 s |

GFS<->EURO differ **87.3 deg**. GFS and ICON both carry a ~1.25 m E-NE groundswell EURO does not have.

**CONTROL** (spots whose lanes agreed on score): Ekas Bay 3-9 deg, Lakey Peak 1.6-12.8 deg, Desert
Point 1.2-2.5 deg. The divergent spots run **7-70x the background**, so this is a real localised
disagreement, not noise.

⇒ The product serves **one** model (GFS by default) with **no spread published**. Our own skill
census ranks GFS **worst** of the three (MAE 0.388 vs EURO 0.223, and 2.3x worse on flat water, where
over-reading claims surf that is not there). **Spread is the missing quantity** — and ledger #3's
free 50-member `ifs/waef` ensemble is the principled source for it.

⛔ Do NOT blind-flip the default to EURO: `EURO` is three upstreams (`ecmwf`, `copernicus`,
`gfs_estimated_fallback`), `ecmwf` is worse than GFS at 36% of coverage, and §3 above shows one of
its channels is broken.

---

## §5 THE 85-YEAR HISTORY — **VERIFIED WIRED**, 7.3% COVERED

The ERA5 climatology flows: campaign -> inbox batch -> `merge_frames_into_climatology` -> histogram
-> `reference_from_hist` (clamped p80) -> `served_reference_size_m` -> `size_gate` in the rating.

**Proved by an accidental control.** The campaign log records the reference it computed per spot:

| spot | ERA5 log | served `reference_size_m` | banked? |
|---|---|---|---|
| Arugam Bay | 1.346 | **1.336** (0.7%) | yes, batch 002 |
| Honolua Bay | 1.465 | **1.417** (3.3%) | yes, batch 001 |
| **Laniakea** | 1.771 | **1.596** (10%) | **NO — spot 32, last checkpoint at 30** |

The two banked spots match; the spot whose batch was lost when the process died does not. That is a
natural experiment confirming both the wiring and the checkpoint-loss behaviour.

**Coverage: 130 / 1,773 = 7.3%.** For the other 92.7% the size reference is still a percentile of our
own recent forecasts — circular, and the reason the level ladder cannot yet be re-derived as
percentiles.

**Throughput, measured (not from the docstring, which is 3.1x optimistic):** median **241 s/spot**,
degrading 113 -> 426 s within a run; pure compute 4.6 d but observed **wall-clock 20.7 d**. The gap
was supervision: the only supervisor fired once daily. **An hourly trigger was added today** (owner
ran it; verified `every=PT1H`), which should take this to ~7 d.

⚠️ **Remaining gap: the hourly trigger heals a DEAD job, not a WEDGED one.** `MultipleInstances:
IgnoreNew` means a hung-but-alive process blocks every retry forever. A liveness check (log mtime
older than N minutes -> kill) is the missing piece.

---

## §6 THE WEATHER SIM — IT WORKS; ITS INPUTS DO NOT

Exercised live: `get_weather_forecast`, `simulate_weather_change`, `find_best_window`.

**What is genuinely good:**
* **Chain parity holds.** Sim vs served height within **0.65-1.08%** at every spot tested; quality
  delta 0.1-0.4 with `level_differs: false`. The ONE FORECAST COMPOSITION mandate is being honoured.
* **`why` is fully decomposed** — all nine factors, the limiter named, and
  `score_if_this_were_1_0`, with `reconstruction_error: 0`. This is the field that made this entire
  audit possible.
* **The what-if holds the real forecast** for anything you omit and returns `baseline_delta` naming
  exactly what changed. That is the right design.
* `find_best_window` scores every hour through the same chain and reports `surfable_light`.
* Provenance is published: model, run_time, wind_run_time, product_id, geometry readiness+source.

**What is wrong, and none of it is the sim's own fault:**
1. It inherits §2 — it reports "4.4 ft Chest High" and "3.6/100 very_poor" in one payload.
2. `quality_confirmed: null` on **every** frame -> the gate caps display at 69.9 (see §7).
3. `find_best_window` over 48 h at Pipeline returns **nine frames, all `very_poor`**, best 3.6/100.
   A user asking "when should I surf?" gets no usable signal — the dynamic range is spent below 4.

---

## §7 THE "GOOD" GATE — CORRECTED TODAY

The 08-04 morning handoff claimed `P(display >= good) = 0 exactly`. **Refuted and corrected in
place**: production serves `level: "good"` right now (Rock Island 71.0, Cloud 9 - Inside 72.0,
`confirmed: "good"`). P is **~0.2% (2/979)**, not zero. The conditional claim stands: while
`confirmed is None`, `min(raw, 69.9) < 70`.

`internal_confirmation` is **frame-dependent**, so any probe hard-coding "the baseline is 0" voids
spuriously. Build controls against production's own served `confirmed` field, never a remembered
constant.

The statistic remains wrong in shape — it counts threshold crossings, not agreement, so Majestics
(90.2 / 72.4 / **5.6**) satisfies "2 of 3 >= 70". But it is now **downstream** of §2 and §4.

---

## §8 FRONTEND / LIVE MAP — HEALTHY

Driven on the local harness (real Render data). **No console errors.**

| check | result |
|---|---|
| Engine boot | marine (87,616 crests) + wind (147,456 particles), both registered |
| StrictMode double-invoke | logs twice but `engine_init: 1`, `framebufferCount: 1` — **no GPU leak** |
| Layer toggle (Waves) | `aria-pressed` false->true; textures 2->9, uploads 2->17, GPU 0.7->34.4 MB |
| Zoom out/in + pan across `zoomedOutMaxZoom=7` | completes; governor never blocked, 0 cooldown, 0 in-flight |
| Scrubber | `role="slider"`, range 0-336 h, `tabindex=0`, keyboard scrub 0->6 works |
| Ring reader (`__RAW_RING_REPORT__`) | **3 pass / 0 fail / 6 skip** — every skip an explicit refusal |
| react-scan | correctly gated to localhost or `?reactscan=1` — not shipped to users |

**Findings:**
1. ⚠️ **Texture count grows monotonically across zoom gestures** — 9 -> 11 -> 13 -> 17 over four
   gestures, +20 uploads, nothing released. Memory grew only 2.7 MB so each texture is small, but no
   release was observed. Worth a longer-session watch. *(Caveat: rAF was throttled in a hidden tab;
   a visible tab may recycle differently.)*
2. ✅⛔ **a11y — one half was real and is FIXED, the other half was MY MEASUREMENT ERROR.**
   * **REAL, fixed `e9b76900`:** the wheel served `aria-valuetext=""`, so a screen reader announced
     a bare number with no unit. The JSX declared `aria-valuenow` but not `aria-valuetext`, which
     only the imperative `setAria()` set — and that never runs at mount. Verified live: "Now" /
     "+6 hours" / "+1 hour".
   * ⛔ **REFUTED — "two sliders carry the identical label".** `MapWeatherControls` does mount twice
     (`isDesktop` true/false) so the DOM really holds two wheels, but the hidden one is **not
     rendered and not focusable**, and the ACCESSIBILITY TREE exposes exactly **ONE** slider.
     Measured: hidden wheel `getClientRects()==0`, `offsetParent==null`, `focus()` does not land;
     `read_page` lists a single `slider "Forecast timeline wheel"`.
     ★★ **THE LESSON: `querySelectorAll` sees DOM nodes regardless of rendering, so it cannot judge
     accessibility — and the a11y tree is not authoritative either (see item 3: it falsely reported
     12 anonymous buttons the same day). THE ARBITER IS BEHAVIOURAL — client rects plus whether
     `focus()` actually lands.** Believing this would have cost a risky refactor of MapPage's
     dual-mount layout to fix a defect that does not exist.
3. ✅ **Correction to my own earlier read:** `read_page`'s accessibility tree showed 12 unnamed
   buttons in the weather controls. **That was the misleading instrument** — DOM inspection shows all
   nine layer toggles carry text labels *and* `aria-pressed`. 0 of 63 buttons are truly anonymous.

---

## §9 DATABASE — CLEAN

Supabase project `jnfbxcvcbtndtsvscppt` (production; note `backend/.env` points at
`weewaulkwfwlbhqemxma`, so local reads silently return None — a standing trap).

* **0 ERROR advisories.**
* 135 x `rls_enabled_no_policy` (**INFO**) — RLS on with no policy = deny-by-default. Secure; worth a
  pass to confirm each is intentional rather than a table whose feature is silently dead.
* 1 x `auth_leaked_password_protection` (**WARN**) — disabled. One toggle in Auth settings.

---

## §10 DEPLOYMENT

`origin/main` (production Netlify) is **104 commits behind `origin/dev`**, last moved
**2026-08-02 09:45**. Every fix from the last two days — the gate forensics, the `quality_rating`
contract fix (`ab905a00`), the transient-cache fix (`77f66211`), the conditions height/offshore fix
(`bc304e44`) — is live on the preview and **not in production**.

*(Memory's "main is 992 commits behind" was already retracted and is stale; the real gap is 104.)*

---

## §11 WHAT I GOT WRONG IN THIS AUDIT

| claim | killed by |
|---|---|
| "The exposure cliff is the root of the cross-model spread" | the lanes disagree **87 deg** on direction — far more than any boundary effect; the function is innocent |
| "`swell_exposure` is discontinuous at 90 deg" | arithmetic: it is **continuous** (-> 0.10 both sides). What diverges is *relative sensitivity* (-0.9%/deg at 30 deg vs -13.5%/deg at 89 deg) |
| "FLIP spots have higher cross-model spread" | its own control: median ratio **0.90x**. Only the tail moved |
| "FLIP is concentrated on degraded geometry" | cross-tab: 38% vs 42% — indistinguishable |
| "EURO reads ~5 because of a coverage hole" | it carries real inputs (0.743 m, 9.7 s) — NOT the coverage class |
| "12 unnamed buttons in the weather controls" | DOM inspection: 0 of 63 anonymous. The a11y tree was the wrong instrument |

★ Not one of these came from a green suite or a code review. Every one came from a control, a
cross-tab, a primary source, or reading the served artifact.

---

## §12 THE QUEUE, IN JACOBIAN ORDER

1. ⭐⭐⭐ **Reconcile the two directional factors (§2).** Highest leverage: it is the number the user
   reads, it is wrong on ~1 spot in 5, and it makes the sim self-contradictory. Needs a **directional
   A/B harness first** — the owner anchors are blind to it. Do not touch the floor before that exists.
2. ⭐⭐ **Refuse impossible waves at ingest (§3).** Small, self-contained, and it stops a lane
   asserting authority for values that cannot exist. Ship the steepness filter + honest `warnings`.
3. ⭐⭐ **Publish spread (§4).** The free `ifs/waef` 50-member ensemble is already on an endpoint we
   fetch. Spread as confidence is also the principled replacement for the gate.
4. ⭐ **Let the ERA5 campaign finish (§5)** — now hourly-supervised. Add the wedged-process liveness
   check. It unblocks percentile levels, empirical exposure, and the learned nearshore transform.
5. **Promote `dev` to `main` (§10)** once 1-3 land.
6. Minor: ~~scrubber `aria-valuetext`~~ ✅`e9b76900` · ~~duplicate slider labels~~ ⛔REFUTED, not a
   defect (the a11y tree exposes one slider) · the leaked-password toggle; a longer
   texture-lifecycle watch in a visible tab.

---

## §13 INSTRUMENTS ADDED TODAY (all carry a control that could exonerate the suspect)

| instrument | question |
|---|---|
| `confirmation_statistic_probe.py` | is the confirmation statistic wrong or merely strict? (control = production's own `confirmed`) |
| `served_good_spotcheck.py` | does the product ever display `good`? (refuses on a flat hour) |
| `model_divergence_attribution.py` | is a 17x disagreement physics or a data hole? (dumps an agreeing spot as background) |
| `exposure_flip_census.py` | does the exposure floor make the spread? (NONE class as background; voids on empty treatment) |
| `lane_swell_direction_probe.py` | do lanes disagree on direction? (needs no shore normal; voids if zero bearings parse) |
| `wave_physics_validity_census.py` | does every served wave obey wave physics? (a law, not a range check) |
| `euro_windwave_period_primary_source.py` | is the bad period ours or upstream's? (asks the origin) |
