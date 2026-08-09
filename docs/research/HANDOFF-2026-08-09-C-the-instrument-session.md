# Handoff 2026-08-09 (C) — the shadow A/B, and five things I got wrong

Session range `44cc2ddd..668548be` (mine: 16 of the 24 commits in that span; the rest are the
concurrent report-11 session working the same tree). Backend full composition lane **720 passed /
64 skipped**; frontend **1916 tests / 207 suites** all green at the end, run together rather than
per-commit so cross-change interactions were actually exercised.

---

## ⭐ THE HEADLINE — the platform can now answer "what would this flag have done?"

`scripts/science_shadow_ab.py` replays SERVED spot-hours under a candidate flag set. Every
calibration decision before this was a flag-flip gamble.

- **Provenance at use time.** `rate_one_spot` persists a per-row `inputs` dict (offshore Hs, swell
  dir, wind speed/dir, shore normal, break depth) so a spot-hour is replayable with SHARED inputs —
  no re-resolve, no generation skew. Declared on `SpotRatingItem` (pydantic drops undeclared keys).
- **The self-check is the spine.** The baseline arm must reproduce the persisted score or the row is
  DISQUALIFIED. A non-reproducing baseline means the replay has become a second forecast path, and
  its candidate arm would be judging against fiction.
- **Refusal semantics, corrected once.** `rows_replayable == 0 && disqualified == 0` is ABSENCE
  (exit 0, "NOT READY"); `disqualified > 0` is BREAKAGE (exit 3). Collapsing both into exit 3 cost
  two false CI alarms before the split.
- **Run it with** `--candidate SURF_TIDE_DEPTH=1` (dispatch-only workflow). ⏳ First real run was
  still pending at handoff: the frames must be written by a precompute at/after `b114a9a4`.

⚠️ **`--candidate REFERENCE_LANE=cell` measures a COUNTERACTING term, not E#1** — see below.

---

## ⛔ FIVE THINGS I GOT WRONG, AND WHAT CAUGHT EACH

Recorded because the pattern matters more than any single fix: **the instrument failed far more
often than the subject, and every failure was caught by a control, never by a green suite.**

1. **E#1's cause — refuted BY SIGN.** I documented the cell-vs-spot reference gap as the cause of
   the band/glyph divergence, and put it in a module docstring. The concurrent session measured the
   band reading **2.3–2.7× ABOVE** the glyph; a LARGER reference scores **LOWER** (verified: 33.5 at
   ref 1.481 vs 21.9 at 2.164). The gap predicts the band reading LOW — opposite sign, so it is a
   counteracting term. Retracted in place (`fa0ec8b1`).
   ⇒ **A mechanism that predicts the wrong sign is refuted, not "partial". The sign test is binary
   and cheap; run it before believing a mechanism you like.**
2. **My own payload nearly doubled a client-downloaded blob.** The `inputs` dict cost **+137 B on a
   320 B row (+42.8%)**, ~1.4 MB across the object every client fetches — nearly double the +23%
   that had justified interning `run_time` out of that same blob, with the precedent six lines
   above mine. Caught by pricing my change ~50 min before the cron shipped it. Fixed with a **5%
   deterministic md5 sample** (+2.1%, still ~530 replayable rows). `hash()` would have been wrong:
   `PYTHONHASHSEED` randomises per process and >1 worker writes the blob.
   ⇒ **An instrument may not tax the product it measures.**
3. **"ICON has data to 216 h" — unsourced.** `capabilities.py` declares ICON wind native 120 /
   estimated 216 / max 336, and **120 + 216 = 336**: the 216 is a TAIL LENGTH, not an hour. I had
   read it as a horizon and nearly moved a cutover on it. Pinned by test with the arithmetic in the
   failure message.
4. **Three probe bugs in one afternoon** — a string match counted a COMMENT as a consumer; a regex
   with the `/s` flag matched under node but NOT under jest's transform (reporting 0 while the
   import sat plainly there); a heredoc collapsed `\n` into a literal newline and broke the parse.
5. **A fixture that silently measured the wrong thing** — `{tier:'premium'}` resolves to GUEST,
   because `getUserTier` reads `subscriptionTier`/`tier_id`, not `tier`. Every assertion would have
   measured the guest cap under a premium name. Caught by the positive control ("a MATCHING id does
   bind: fog = 7 days").

---

## ⚠️ OPEN — OWNER DECISIONS, each with its measurement attached

| # | Decision | Evidence | Why it is not mine |
|---|---|---|---|
| 1 | **Band-fade dead zone**: spans 9.5–40° ship a fully RATED grid painted at **alpha 0**. `__RAW_RATING_SPAN_FADE_HI__=40` closes it (pinned by test). | `FINDING-2026-08-09-the-rating-band-dead-zone.md`; 3 tests | Visible product change over 2° cells; wants an eye + zoomlab trace |
| 2 | **Per-layer forecast cap inoperative** for `rain`/`temperature`/`water_temp` (match neither capability `layer` nor `domain`, so ICON marine's 336 h caps ICON rain's real 168 h). One-line alias map fixes it; mutation-verified to flip exactly that assertion. | `LayerAccessResolver.layerKeys.test.js` | Fixing REDUCES the advertised window (14 d → 7 d) |
| 3 | **Radar legend units**: raster is RainViewer scheme-7 reflectivity, label says dBZ (correct), stops are rain-rate shaped (`0/.1/.3/.5/2+`), readout is MODEL mm/h. | `radarLegendUnits.proof.test.js` | Needs the scheme-7 palette spec — a PRIMARY SOURCE not in this repo. **I refused to invent dBZ numbers**; fabricated thresholds read as measured ones. |
| 4 | **Undisclosed stale frame → disclosed, not closed.** Past a model's axis the tile lane clamps and paints the LAST frame under the requested hour. `describeStaleHour` now says so; the live-axis `min()` floor that would stop it is unshipped. | `staleHour.proof.test.js` | Changing what the map paints past a horizon is a product call |

⚠️ **#2 and #4 COMPOSE**: one lets a user ask for hours the layer lacks, the other silently serves a
stale frame for them. Fixing either alone leaves the pair half-open.

---

## ✅ SHIPPED (mine, by SHA)

`44cc2ddd` shadow A/B · `c30df231` round-trip + tolerance above the rounding grid · `df7a3d73` E#1
measurable + dead zone found · `25fcb183` + `b114a9a4` LOC/payload self-corrections · `fa0ec8b1`
the sign retraction · `5e920a5d` ft/m reaches the cards (and the drifted 3.281 that hid behind five
test mocks) · `363f1cd2` fog read `--` on EURO/ICON while a GFS raster was on screen · `d35c466e`
NOT-SAMPLED ≠ BROKEN · `5a502dfb` legend numbers up to **47 pp** from their colours · `8b20f2c3`
eight cutovers named, drift guarded · `a71b45d3` stale-frame proof + discriminator · `f0c29ebb`
stale-hour disclosure · `09c64d05` access-cap proof · `668548be` radar mismatch pinned.

---

## ▶ NEXT

1. **Run the tide A/B** once a precompute at/after `b114a9a4` has written frames:
   `gh workflow run science-shadow-ab.yml -f candidate=SURF_TIDE_DEPTH=1`. It REFUSES honestly if
   the frames are not ready — that is not a failure.
2. **Owner decisions 1–4 above**, in that order of cheapness.
3. ⛔ **Do not tune either band/glyph lane** until the per-cell composition sub-term is isolated —
   that work belongs to the concurrent report-11 session.
