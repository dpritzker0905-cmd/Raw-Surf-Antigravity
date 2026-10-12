# 2026-10-12 · Can beach's second streak row, the land mask and the streak solver go now that the streak is white? Measured: no

Local side session (Windows, AMD Radeon 890M, D3D11), the "simplification pass" lane of the light/beach-mirror-dark work. Branch
`claude/stoic-heisenberg-bbe771`, cut from `origin/dev` at `ec8f46a2` (#314's merge). Times are UTC. **No source file is changed by
this session: it measured, and the measurement says do not build.** No word of the owner reached this session first-hand; the
brief came from the session that built #313, written while #313 was still open.

**The brief:** make light's and beach's wind drawing as simple as dark's now that both draw dark's white streak (D-021), by
removing the streak machinery that no longer changes what is seen, with proof: beach to ONE streak row, the land mask no longer
bound or fetched for either theme, the streak half of `solveDarkRules` no longer called by default, all behind one kill. Measure
first; if the difference is visible, do not remove the rows, report the numbers and one recommendation.

## Start (02:33Z): the gate, and what had changed under the brief

- **Checked live:** `git fetch` (dev `ec8f46a2`); `gh pr view 313`: MERGED 2026-10-11T23:14:33Z; `gh pr view 314`: MERGED
  2026-10-12T01:48:08Z; open then: #264 only (#315 opened at 03:07Z, during this session). `memory_audit.py --docs-only`: 0 FAIL,
  13 WARN, 14 NOTE, none of them this lane's.
- **The gate passed in its letter:** #313 is merged and its look was kept, tuned in strength and not in the ring (D-021, amended
  2026-10-12; D-022).
- **But #314 (D-022) merged after the brief was written, and it gave the land mask a second job.** The mark shader's one mask
  sample now also scales the mark's light by the ground under it (`u_white`, set by `bindLandMask`): full over land, 0.77 of it
  over beach's sea and 0.55 over light's. A mask that is not bound or fetched is D-022 switched off. **That third of the brief
  is void**, whatever the rows measure.
- **Light has nothing left to remove.** Under the white streak its two rows are one table twice (`darkRulesTables` returns
  `LIGHT_LOOK_MARKS.deep` for both) and `solveDarkRules` is not called for it at all.
- **What was left to measure:** beach's sea row against its land row, and with them the solver's streak half for beach.
- **Other lanes, read and not written (their worktrees):** border ink (`windBasemapMute.js`), light's colours (scratch solvers
  so far), and the lead session's beach sea 0.77 to 0.55 (`windDarkRules.js`; PR #315, open 03:07Z). This lane touched none of
  their files.

## 02:44Z · Per knot: the two rows are not one row with two names

A scratch probe (`rows-probe.mjs`) on dev's own tables and the composite model of `windWhiteStreak.test.js` (the "head" of a
streak over its ground), plus the mark's bare core (the centre pixel, which the ring does not cover).

**The premise was half right.** D-021's record says the ring "hides most of their colour": true at the head (C* 21.5 or less,
whichever row). But a row is four numbers a knot, and the fourth is the mark's ALPHA. `DRAW_FS` writes the mark at
`v_alpha * soft * color.a`, and `SCREEN_FS` lays a trail at its brightness SQUARED, so a row's alpha sets how strongly the white
is laid, as its square. The solver lowers a row's alpha wherever the hue's full colour would step too far over that ground, and
beach's sea is the deeper ground:

| beach, by speed | (sea alpha / land alpha) squared | the two rows' colours apart (dE00) |
|---|---|---|
| 0-5 kn | 0.65 to 0.79 | 4.2 to 17.8 |
| 6-24 kn (the everyday winds) | 0.77 to 0.83, median 0.815 | 2.3 to 4.0 |
| 25-36 kn | 0.67 to 0.95 | 2.6 to 20.0 (27 kn: land row `243 255 204`, sea row `176 255 0`) |
| 37-58 kn | 1.00 (the two alphas are equal; 0.88 to 1.00 from 59 to 64 kn, 1.00 above) | 6.9 to 14.8 |

**So beach's sea row is a second "less white over the sea"**, about 19% less at the everyday winds, on top of D-022's sea
number. D-022's 0.77 was measured with that row in place: the two are one calibration.

What one row instead of two would change on screen, modelled, largest over 0-75 kn (median over 6-24 kn in brackets):

| one row kept | marks that change | white | head: dL* / dC* / dE00 | core: dL* / dC* / dE00 |
|---|---|---|---|---|
| the land row | over the sea | 0.77 (dev) | +8.8 at 31 kn / -9.0 / 7.75 [4.7 / 1.2 / 3.85] | +7.8 / -50.7 at 27 kn / 15.33 |
| the land row | over the sea | 1 (D-022's kill) | +11.2 / -11.5 / 10.07 | +9.9 / -61.5 / 17.80 |
| the land row | over the sea | 0.55 (#315) | +6.3 / -6.6 / 5.66 [3.4 / 1.0 / 3.04] | +6.7 / -38.5 / 12.32 |
| the sea row | over land | 1 | -7.9 at 31 kn / +13.7 / 9.10 [5.0 / 2.3 / 3.74] | -9.6 / +62.2 at 27 kn / 17.34 |

The head's hue turns 5.1 degrees at the most. Light: 0 on every line (its rows are one row).

## 02:50-02:58Z · On the GPU: the offline map bench, pixel for pixel, land and sea read apart

`map-run.js --offline --crop 1000x1000:png`, zooms 4, 6, 8, 10, served strength and `--scale 2.3`, 180 frames, seed 1, Mobile
Bay. A scratch reader (`crop-diff.mjs`) decodes two crops, files each pixel under land or sea by the bare-basemap crop, and reads
the difference in CIELAB.

**The brief's own method, corrected for D-022.** "Mask on against `--no-land-file`" now changes two things at once (the row AND
D-022's strength), so both arms were run under `__RAW_DISABLE_WIND_DARK_WHITE__` (white 1 on both grounds): then the mask
changes the row and nothing else.

**Controls, all passed:**
- Light (equal rows) and dark (reads no mask), mask against no land file, under that kill: 16 of 16 `full` crops are the same
  PNG, byte for byte (4 zooms, 2 strengths, 2 themes). The method reads the rows and only the rows, and two separate runs are
  deterministic.
- A two-line scratch prototype (`__RAW_WIND_PROTO_ONE_ROW__` = `'land'` | `'water'` in `darkRulesTables`; never committed,
  reverted before this commit) to read one row AT THE DEFAULT, with the mask and D-022 kept: with no lever its bundle draws dev's
  bundle's PNGs (beach, 8 of 8: 4 zooms, 2 strengths), and its land row under D-022's kill draws the `--no-land-file` PNGs (8 of 8).

**Beach, one row instead of two, at the default (D-022 on, sea 0.77). The share is of that ground's pixels:**

| | zoom 4 | zoom 6 | zoom 8 | zoom 10 |
|---|---|---|---|---|
| **the land row everywhere: the SEA changes** (served) | | | | |
| pixels that differ at all | 78.6% | 93.1% | 91.9% | 73.2% |
| differ by more than dE00 2.3 | 29.0% | 67.2% | 37.2% | 3.4% |
| largest dL* / dC* / hue turn | +11.2 / -79.7 / 31 | +11.5 / -78.0 / 34 | +10.8 / -59.4 / 10 | +7.7 / -44.4 / 6 |
| the sea's mean L* | +1.11 | +2.36 | +1.44 | +0.66 |
| the same, storm strength: differ / over 2.3 / mean L* | 78.7% / 36.1% / +1.34 | 91.7% / 49.4% / +2.19 | 84.6% / 21.7% / +0.96 | 91.4% / 41.2% / +1.40 |
| **the sea row everywhere: the LAND changes** (served) | | | | |
| pixels that differ at all | 82.1% | 70.3% | 79.2% | 72.3% |
| differ by more than dE00 2.3 | 28.5% | 20.8% | 5.8% | 3.4% |
| largest dL* / dC* / hue turn | -9.6 / +55.7 / 41 | -11.2 / +76.0 / 36 | -7.3 / +20.6 / 8 | -7.5 / -17.0 / 8 |
| the land's mean L* | -0.76 | -0.78 | -0.81 | -0.66 |
| the same, storm strength: differ / over 2.3 / mean L* | 82.6% / 32.6% / -0.83 | 94.7% / 48.8% / -1.44 | 97.0% / 42.0% / -1.29 | 93.1% / 31.0% / -1.36 |

Rows only (white 1 on both grounds, mask against no land file), the sea: 75.3 to 93.3% of pixels differ served and 79.6 to 92.8%
at storm strength; 5.3 to 73.6% and 27.5 to 57.6% by more than dE00 2.3; largest +12.8 L*, -79.5 C*, a hue turn of 33 degrees;
the sea's mean L* +0.70 to +2.73. With the land row kept, the land itself moves only where the mask eases across the coast (at
most 0.5% of land pixels over dE00 2.3 served, 7.3% at zoom 10 in a storm).

## 02:58-03:10Z · In motion, on the real basemaps, in the owner's unit

`motion-run.js --dpr 1.5` (Mapbox tiles only; nothing asked the Raw Surf backend), served wind, zooms 9, 6, 5; `mirror-run.js`
with the sea at `--at 0.5,0.9` and the land at `--at 0.5,0.12`. Lift is in L*; in brackets, against dark's at that zoom.

| over the sea | zoom 9 | zoom 6 | zoom 5 |
|---|---|---|---|
| dark, lift | 7.3 | 12.5 | 10.8 |
| beach today (two rows): lift / picture / peak / kept | 6.5 (0.89) / 63.4 / 76.3 / 1.04 | 11.5 (0.92) / 64.6 / 79.2 / 0.93 | 13.9 (1.29) / 62.9 / 78.3 / 1.04 |
| beach, the land row everywhere | 7.1 (0.97) / 63.9 / 77.4 / 0.90 | 12.1 (0.97) / 66.8 / 81.3 / 0.88 | 14.5 (1.34) / 64.1 / 79.8 / 1.01 |
| beach, the sea row everywhere | 6.4 (0.88) / 63.3 / 76.1 / 1.08 | 11.4 (0.91) / 64.5 / 79.2 / 0.94 | 13.9 (1.29) / 62.9 / 78.3 / 1.04 |

| over land | zoom 9 | zoom 6 | zoom 5 |
|---|---|---|---|
| dark, lift | 8.7 | 9.0 | 10.7 |
| beach today: lift / peak / flicker | 6.4 (0.74) / 74.5 / 1.122 | 9.0 (1.00) / 78.5 / 1.643 | 10.3 (0.96) / 83.6 / 1.848 |
| beach, the land row everywhere | 6.4 (0.74) / 74.7 / 1.134 | 9.0 (1.00) / 78.5 / 1.643 | 10.3 (0.96) / 83.6 / 1.848 |
| beach, the sea row everywhere | 6.0 (0.69) / 73.8 / 1.050 | 8.7 (0.97) / 77.4 / 1.539 | 9.9 (0.93) / 82.0 / 1.707 |

- **The pairs that should be equal are:** the sea under "today" and "the sea row everywhere" reads within 0.1 L* of lift at every
  zoom, and the land under "today" and "the land row everywhere" reads the same to the digit at zooms 6 and 5 (at zoom 9 that
  crop holds a coast, where the mask eases: the same lift, peaks 74.5 and 74.7). The probe's noise inside one run is about 0.1.
- **The land row everywhere lifts the sea 0.6 L* further (4 to 9%) and the picture there 0.5 to 2.2 L*;** the lift understates
  it, because with stronger trails a pixel's darkest moment rises too (the probe's "ground": 53.1 to 54.6 at zoom 6). The cores
  go 1.1 to 2.1 L* lighter and keep less of the ground's colour (0.93 to 0.88 at zoom 6).
- **Where the eye catches it is the storm.** In the wide clip the 25-36 kn band around the eye, over the Gulf, turns into a pale
  ring: the land row is pale there (the solver mixed white into it to reach dark's step over a ground the name guard holds
  pale) and its alpha is higher. It is beach's cream ring over land (D-021, "the gale band"), painted over the sea as well.
- **The sea row everywhere dims the land:** lift 3 to 6% less and flicker 6 to 8% less, where beach's lift over land is already
  short of dark's and white cannot add more (D-022).
- **Two clips sent to the owner** (03:12Z; `compose-video.js`, zoom 5 and zoom 9, five panes: dark, light, beach today, beach
  with the land row everywhere, beach with the sea row everywhere; titled as a prototype, nothing built). No verdict yet.
- **A number that does not match the record, not explained:** beach's sea at zoom 6 read 0.92 of dark's lift here and 1.01 in
  D-022's log (land 1.00 here, 0.93 there); zoom 9 agrees within 0.05 and dark's own ink at zoom 6 is that log's (34.48). Two
  sessions' runs on Mapbox tiles; not investigated. Every comparison above is inside one run.

## The verdict, and one recommendation

**The difference is visible. Nothing is removed, and nothing is built.**

- **The land mask stays:** it is D-022's instrument (the white by the ground). The brief predates that.
- **Beach's two rows stay:** either single row changes most of one ground's pixels, in the direction the owner has asked to
  move away from. The land row everywhere lays the sea's white about 23% stronger at the everyday winds (1 / 0.815) and paints
  a pale ring on a storm over the sea; the owner's own step today was the other way, 0.77 to 0.55, a cut of 29%. The sea row
  everywhere dims the land, which cannot spare it.
- **The solver's streak half stays** for beach: it is what makes the two rows. For light it is already not called.
- **Light:** nothing to remove; the mask it binds is D-022's.

**Recommendation: leave the streak code as it is. If one row is still wanted, do it as a small LOOK change the owner watches,
after beach's sea strength has settled, not as a silent cleanup:** keep the land row and fold the sea row's share into the one
sea number (the sea number times 0.815). That holds the everyday winds over the sea within about 5% of today's strength (-5.0%
to +2.1% from 6 to 24 kn), lays gale winds over the sea (37 to 58 kn) 18% weaker than today, and still changes the core's
colour at 27-40 kn, so it needs the owner's eye and its own kill; it cannot be proved by identical pixels.

## What this lane moves in the other lanes' outputs

Nothing: no source file changed. Read on ground {land, sea} x wind {served, x 2.3} x zooms {4, 6, 8, 10} offline, and ground
{land, sea} x zooms {5, 6, 9} served in motion. For the lead's sea number: beach's "0.55" and light's "0.55" are not the same
unit. Light has one row; beach's sea row multiplies beach's number by about 0.815 at 6-24 kn, less from 25 to 36 kn, and by 1
from 37 kn up, so beach's effective strength over the sea rises with the wind: one more reason one number reads differently in
a breeze and in a storm (#315's L-V50).

## Not verified, and limits

- **Nothing here was seen in the app.** One view (Mobile Bay), one wind field (the served GFS of 2026-10-09 15Z, and it scaled
  2.3 times); the offline basemap is synthetic and at pixel ratio 1; phones not measured.
- **"Visible" is this session's reading:** the share of a ground's pixels over dE00 2.3 in still frames, the mean shift of the
  picture, and one still of the wide clip that this session looked at (the pale ring). The owner has the clips and has not
  answered.
- **One row at beach's sea 0.55 (#315) was modelled, not rendered:** dev draws 0.77. The model reads the effect about a quarter
  smaller there (head +6.3 L* at the most; dE00 3.0 at the median of the everyday winds).
- **The model's head and core are two pixels of a mark,** not the trail a moving mark leaves; the GPU crops are the authority.
- **Gates:** no source file changed, so Jest, the lint ratchet, the palette checker and the production build were NOT run:
  they would test dev. `memory_audit.py --docs-only` and `action_ledger.py verify` were.
- **No ledger line is appended by this change, on purpose.** #315 (open since 03:07Z, the owner's own request) holds the chain
  at seq 1063-1067 and the border-ink lane's PR owes `pr_merge #314`; a third branch extending seq 1062 would fork it for a
  docs-only record. Owed, on dev's chain once #315 has merged: a `correction` line (STATE's 2026-10-11 21:08Z entry and D-021
  said this machinery "now does little"; both carry a dated note from this change) and this PR's `pr_open` line. Whichever PR
  holds the pen next can write them; this log is their evidence.

## Instruments (scratch, not committed; copies in the session group's notes folder, `streak-rows-instruments/`)

- `rows-probe.mjs`: the two rows per knot, and what one row would change at the head and the core, at each white strength.
- `crop-diff.mjs`: two map-bench crops pixel for pixel, land and sea apart (its own PNG decoder; CIELAB and CIEDE2000). The
  bench today compares crops by PNG bytes only: "equal or not". This says how far apart and on which ground. Worth committing to
  `scripts/wind-bench/` with the next change that needs it.
- `video-frame.js`: one frame of a WebM as a PNG, through Playwright's Chromium (the ffmpeg Playwright installs cannot write an
  image).
- `one-row-prototype.patch`: the two scratch lines.
