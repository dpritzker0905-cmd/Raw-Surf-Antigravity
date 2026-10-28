# 2026-10-27: research round 2, instant and correct marine layers (researcher session)

**2026-10-27, 17:00-23:30Z.** The owner (16:40Z, relayed by the lead) asked for one standing researcher in this subtree, "using skills
to research animations, science, math, and any other logic that can help us make this work instantly and to state of the art".

- **Deliverable:** `docs/research/instant-marine-sota-2026-10-27.md`, PR #613 (draft, base `dev`).
- **Ledger:** `ledger.d/claude--research-instant-marine-r2.jsonl:1` (pr_open #613).
- **No served number changes.** Docs only: no product code, no flag, no SCOREBOARD row, and no request to the Render box or the
  dev site.

## What was found

**The structural pattern behind what is left (code at `dev` `4bd90d0d9`):**

- **Zoom picks a PRODUCT, and a refusal falls back to `/grid`.** For EURO and ICON, every narrow, z7-9 or band-ON cell is a
  `/grid` round trip. Three mechanisms:
  - the client re-implements the resolver's choice rule by rule (`crop_only_narrow`, `crop_only_set`, the 30-deg clip rule);
  - the server's 2-deg mid tier "sharpens" to a 0.25-deg dynamic product on a later ask for spans up to 8 deg
    (`mid_res_tier.py:260-297`);
  - finer tiers end before coarser ones, with no same-model fallback (GFS regional past h115; ICON/EURO tiles 48 h; no EURO
    2-deg swell).
- **Leaders** (deck.gl, MapLibre, NASA GIBS, Windy's plugin types, earth.nullschool): zoom picks a LEVEL of one product, and the
  only fallback is a coarser level of the same product. This became a 7-item coverage contract (C1-C7).

**Rating band:**

- A rated grid already carries the honest height (`phys_speed`) beside the score, and the client builds both textures.
- Rating frames from `apply_surf_overlay` in CI: a u16 score plane paired with its height frame, keyed by a `chain_hash`. ~1.6-3 MB
  a GFS run.
- A latent behaviour to check: coastal cells that `continue` at `surf_rating.py:740-741, 771-772` keep their offshore height in
  the score channel.

**Infobox:**

- `/point` is asked at the selected hour.
- The server swaps the drawn frame's timestamp to that hour when the file exists (`point_resolution.py:245-261`), so the map and
  the card can each be honest about a different frame, silently.
- The rule: the card follows the drawn frame. Invariants I1-I5, with tolerances per theme (the dark theme's height byte floors,
  `WebGLMarineTextureEncoder.js:346`).

**Perception and code:**

- A held arrow key commits on every repeat (`ForecastWheel.js:305-315`, ~33 a second at a 30 ms repeat); a drag commits at 11 Hz.
- The pending words should wait ~300 ms.
- The always-on crest particles likely need a pause control (WCAG 2.2.2).

**Math:**

- A 6 h gap keeps 0.75-0.78 of a storm peak under any clamped curve. A Gaussian peak with sigma ~4.2 h reproduces 0.94 at 3 h and
  0.78 at 6 h.
- Only cadence fixes it, so EURO real 6-hourly steps to 360 h (L6b) come before interpolation.

**Top five levers:**

1. **N1:** a CDN floor at every tier, with the coverage contract and draw-success telemetry;
2. **N3:** one readout;
3. **N2:** rating frames on the CDN;
4. **N4:** every marine layer resident;
5. **N8:** request lanes keyed on the target.

## How

- **Four parallel research agents:** tiers, rating frames, point/field consistency, perception and browser. Their reports are in
  this session's scratchpad, and this session re-checked every code claim they made.
- **The `huggingface-papers` skill:** one relevant hit, HourGlass, arXiv 2607.11457.
- **One Reflection (Beam) review on selected context.** Its adds are adopted: the C7 "drawn or said" invariant, draw-success
  telemetry, and N3 above N2.

## Owed / not done

- **The z9 EURO h141-h155 diagnosis** is the z9-euro-scrub-stalls session's. N1 should ship after its fix, with its repro in the
  contract test.
- **Unverified, before building:**
  - whether the rating's wind sampler sees the HRRR lane;
  - whether the client hides the latent coastal cells;
  - GFS swell_2 CDN coverage.
- **No timing was measured this session:** the PC was heavily loaded.
