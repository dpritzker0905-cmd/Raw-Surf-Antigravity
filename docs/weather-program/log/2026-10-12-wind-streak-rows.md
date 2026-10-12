# 2026-10-12 · Can beach's second streak row, the land mask and the streak solver go now that the streak is white? Measured: no

Local side session (Windows, AMD Radeon 890M, D3D11), the "simplification pass" lane of the light/beach-mirror-dark work. Branch
`claude/stoic-heisenberg-bbe771`, cut from `origin/dev` at `ec8f46a2` (#314's merge). Times are UTC. **No source file is changed by
this session: it measured, and the measurement says do not build.** No word of the owner reached this session first-hand; the
brief came from the session that built #313, written while #313 was still open.

**Read the sections from "An independent review of this log" down before quoting anything above them.** The review corrected
the mechanism's size (the "19%" and "23%" are one stamp's, an upper bound), withdrew the fallback in "one recommendation" (the
sea number times 0.815), corrected "C* 21.5, whichever row", and "visible" is restated arm by arm. The sections above it stand
as first written, because the correction is part of the record; their tables were recomputed by the reviewer and match.
**And the last section says which wind each row was read in:** "served" is the bench's fixture, a hurricane, not an everyday
wind, and "storm" is that fixture's box multiplied by 2.3.

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

## 03:32-03:37Z · The lift gap against D-022's record, explained: the crop's size

`mirror-run.js` reads a 420 px crop by default; D-022's numbers were read with `--size 360` (its README is corrected in #315).
At 360 this session's frames read the record's numbers: beach's sea at zoom 6 at 1.01 of dark's lift (dark 12.6, beach 12.7;
the record: 1.01 and 12.6), at zoom 9 at 0.92 (0.91); the land at zoom 6 at 0.93 (0.93) and at zoom 9 at 0.71 (0.69). The
bullet above that called the gap "not explained" is answered: the same instrument on another crop. At 360 the one-row arms
read: the land row everywhere over the sea, lift 6.6 to 7.3 at zoom 9, 12.7 to 13.3 at zoom 6, 14.5 to 15.1 at zoom 5 (against
dark's: 0.92 to 1.01, 1.01 to 1.06, 1.34 to 1.40); the sea row everywhere over land, 6.4 to 6.1, 8.1 to 7.9, 9.9 to 9.5 (0.71
to 0.68, 0.93 to 0.91, 0.97 to 0.93).

## 03:38Z · An independent review of this log, and what it corrects

A reviewer was given the diff, the data files and the source, and asked for problems only. It recomputed about 290 numbers:
the alpha table, both GPU tables and both motion tables match, as do the PNG decoder, the CIEDE2000 and the shares'
denominators; the solver was re-evaluated and gives the rows' alphas exactly. Nine statements did not hold. Each correction
names what it corrects:

1. **"a row's alpha sets how strongly the white is laid, as its square", and the "about 19% weaker" and "23% stronger" built on
   it: true of ONE stamp of a mark on a clear buffer, and an upper bound for a trail.** The mark is blended into the trail
   buffer with `(ONE, ONE_MINUS_SRC_ALPHA)` and `color.a` is its cover as well as the scale of its light, so stamps that
   overlap saturate. At 13 kn the sea row's strength against the land row's is 0.82 for one stamp, 0.91 for two, 0.96 for
   three, 0.99 for five. `u_white` scales the light only and stays an exact square at any overlap. Measured in motion the
   sea's lift moves 4 to 11% in the wind as served and 2 to 3% in a storm, not 23%.
2. **The fallback in "one recommendation" (keep the land row, the sea number times 0.815) is WITHDRAWN.** Alpha and `u_white`
   are not interchangeable (1); it was never rendered; its "-5.0% to +2.1%" had the sign turned (the proposal against today is
   -2.1% to +5.3%); the same algebra gives +7 to +21% at 30-33 kn and -18.5% at 37-58 and 65-75 kn; and it keeps the pale land
   row over the sea, which is the ring the verdict rejects.
3. **"C* 21.5 or less, whichever row":** the test's pin holds for each row over its OWN ground at full white (21.2 over the
   sea, 20.2 over land). Today's head over the sea at 0.77 reads up to 24.4 (27.6 at 0.55), and the sea row over land 24.9.
4. **"The difference is visible" was said of both arms** from still-frame pixel shares and one still. It is restated per arm
   and per scene in the next section, from the time-mean of the moving picture.
5. **"the lift understates it, because ... a pixel's darkest moment rises too":** the numbers are right (the picture +0.5 to
   +2.2 L*, the probe's ground 0 to +1.5, the lift +0.6); the "because" was not shown.
6. **"by 1 from 37 kn up", "rises with the wind", "less from 25 to 36 kn"** (the lanes section): the squared ratio is 1.00
   from 37 to 58 and from 65 to 75 kn and 0.88 to 1.00 from 59 to 64; it is not monotone (0.83 at 10 kn, 0.67 at 31 kn, 1.00
   at 40 kn); from 25 to 36 kn it is 0.67 to 0.95, above 0.815 at 4 of the 12 knots.
7. **In the notes this change adds elsewhere:** "6 to 29%" of the land's pixels is 5.8 to 28.5%, "6 to 28%"; "light's two
   equal rows: 16 of 16" counted dark's 8 as light's. Both were fixed in STATE, D-021 and L-P35 before the PR, with (1) and
   (2); this branch's first commit (`b6dbd750`) keeps the first wording.
8. **"The probe's noise inside one run is about 0.1" was not measured.** Measured since: the same run captured twice in one
   session (beach, zoom 6, served, 180 frames) gives the same time-mean picture, 0.0 L* apart at every pixel.
9. **Limits that were missing** are at the end.

## 03:40-03:57Z · Per arm and per scene: the time-mean of the moving picture

`ring-probe.js` (scratch): two runs of one camera, each averaged over time in linear light (every third frame) on a 250 x 250
reduction of the whole frame, then compared in CIELAB. Real basemaps, pixel ratio 1.5. Storm strength is a second capture
(`motion-run.js`, `scale` 2.3, 180 frames a run, zooms 5, 6, 9; the two-line prototype re-applied for it and reverted again).
One row minus today:

| the LAND row everywhere | zoom 5 | zoom 6 | zoom 9 |
|---|---|---|---|
| served: the frame's mean / 99th percentile / largest dL* | +0.37 / +3.1 / +5.6 | +0.68 / +3.5 / +5.3 | +0.29 / +1.3 / +1.7 |
| served: the part lighter by more than 3 L* | 1.4% of the frame: L* 62.8 to 66.2, C* 25.9 to 18.0 | 2.7%: 59.4 to 62.9, 27.0 to 18.7 | none |
| storm: mean / 99th percentile / largest | +0.56 / +4.4 / +6.1 | +0.95 / +4.9 / +6.3 | +0.48 / +2.0 / +2.7 |
| storm: the part lighter by more than 3 L* | 4.5%: 59.3 to 63.0, 28.8 to 19.9 | 9.7%: 55.6 to 59.5, 30.9 to 21.1 | none |

| the SEA row everywhere | zoom 5 | zoom 6 | zoom 9 |
|---|---|---|---|
| served: the frame's mean / 1st percentile / largest dL* | -0.27 / -1.3 / -2.4 | -0.22 / -0.9 / -3.4 | -0.14 / -0.4 / -0.6 |
| served: the part darker by more than 3 L* | none | one cell of 62,500 | none |
| storm: mean / 1st percentile / largest | -0.34 / -2.3 / -4.3 | -0.41 / -2.7 / -5.0 | -0.44 / -1.5 / -2.2 |
| storm: the part darker by more than 3 L* | 0.4%: L* 75.7 to 72.4, C* 16.7 to 27.1 | 0.6%: 70.7 to 67.3, 17.4 to 24.9 | none |

Lift at storm strength, against dark's (`--size 360`, zooms 5 / 6 / 9). Over the sea: today 1.35 / 1.41 / 1.46 (#315 reads 1.38
at zoom 6), the land row everywhere 1.37 / 1.46 / 1.51, the sea row everywhere 1.35 / 1.40 / 1.45. Over land: today and the land
row everywhere 0.92 / 0.97 / 0.09, the sea row everywhere 0.88 / 0.92 / 0.09, with 8% less flicker at zooms 5 and 6.

- **The land row everywhere is seen in a storm.** One part of the picture, the 25-36 kn band over the sea, is 3.4 to 3.9 L*
  lighter with about 30% less chroma: 1.4 to 2.7% of the frame in the wind as served and 4.5 to 9.7% at storm strength, at
  zooms 5 and 6. That is the pale ring of the still. At zoom 9 nothing moves more than 2.7 L*.
- **The sea row everywhere is the far smaller change, and this session cannot call it seen.** The time-mean stays within 1.3
  L* over 99% of the frame in the wind as served and 2.7 at storm strength. In a storm 0.4 to 0.6% of the frame goes 3.3 L*
  darker with MORE chroma (16.7 to 27.1): the land's pale gale band, where the sea row holds the full colour and the land row
  the pale one.

## The verdict, restated (this replaces "The verdict, and one recommendation" above)

**Nothing is removed and nothing is built.**

- **The land mask stays:** it is D-022's.
- **The solver's streak half stays:** it makes beach's rows, whichever of them is kept. Light does not call it.
- **So the brief's three removals come down to one table row and one shader line (the row mix), and behind a kill not even
  those:** the kill has to draw both rows.
- **If one row, the sea row.** The land row rings a storm over the sea. The sea row dims the land's streaks (lift 3 to 6% less
  in the wind as served, 5 to 6% at storm strength at zooms 5 and 6, flicker 6 to 8% less), where beach is already short of
  dark's and white cannot add more.

**Recommendation: leave the streak code as it is.** Not because one row is proved visible (the sea row everywhere is not), but
because nothing is left for it to simplify, and its one measured effect is a small loss over land. If the owner wants it
tried, it is a look change with its own kill and the owner's eye, and this session will build it on that word.

## For the other lanes (this replaces the paragraph on beach's "0.55" above)

This lane changed no source file, so it moves nothing in the other lanes' outputs. Read on ground {land, sea} x wind {served,
x 2.3} x zooms {4, 6, 8, 10} offline and zooms {5, 6, 9} in motion.

One thing for the sea number: beach's sea streaks carry a second, smaller reduction that light's do not, the sea row's lower
alpha. One stamp is 17 to 23% weaker than the land row's at 6-24 kn, 5 to 33% at 25-36 kn and equal at 37-58 kn; less where
stamps overlap; in motion the sea's lift is 4 to 11% under what the land row would give in the wind as served and 2 to 3% in a
storm. It weakens a breeze more than a gale, the direction of the gap #315 measured. It is not a factor on the sea number.

**Seen in passing, out of this lane's scope, not acted on:**
- **Beach's land at zoom 9 at storm strength lifts 1.0 L* where dark's lifts 11.0 (0.09 of it):** the ground there is L* 69.9,
  the pale gale band (D-021's stated cost), with no room above it.
- **Drawn over that band, the sea row keeps the streak's colour** (the probe's `kept` 0.84 to 1.02 at zoom 9; C* 16.7 to 27.1
  where the picture changes most at zoom 5). It may bear on "beach's gale band". The owner's call; not judged by eye.

## Not verified, and limits (added after the review)

- **One seed, one view, one wind field** (as served, and scaled 2.3 times).
- **The offline crops file a pixel by the basemap's colour; the shader picks a row per MARK from a 2048 px mask that eases
  across about 20 km.** Near a coast, and across most of the view at zoom 10, the two grounds are not separated: in the
  sea-row arm 4.5% (zoom 4, served) to 7.8% (zoom 10, storm) of SEA pixels also move by more than dE00 2.3. The largest dL*
  and dC* in the tables are single pixels.
- **Zoom 6 in motion, served, was 120 frames where the other runs were 180.** Repeated at 180 for the sea-row arm: the same
  numbers (mean -0.22, 1st percentile -0.9).
- **A time-mean hides flicker:** a change in how a streak flashes that leaves the mean alone is not in it. The mirror probe's
  flicker column is the only read of that here (6 to 8% less over land with the sea row).
- **The controls' outputs and the bench logs are saved** beside the instruments in the notes folder (`control-*.json`,
  `rows-*.log`, `ring-*.json`, `mirror-*-360.json`), not in the repo.
- **Nothing was seen in the app.** The owner has two clips (the wind as served; sent before the review) and has not answered.

## 04:23Z · Which wind each row was read in: "served" is not an everyday wind, and "scale 2.3" is not everywhere a storm

The session that leads these lanes pointed it out (it had made the same mistake, its L-V50 on #315), and it checks against the
bench's own code: the fixture is one served GFS box, 25 to 32 N and 90 to 78 W, holding a hurricane; around it the world base is
the bench's climatology; and `scale` multiplies the box only (`page/map-entry.js` `init`, `eye.js` `worldBase`). Read from the
fixture with a scratch script (`scene-wind.js`: 512 px tiles, the offline coast for land and sea; knots, median and quartiles):

| what a row was read on | as served | scale 2.3 | share inside the scaled box |
|---|---|---|---|
| motion, the sea crop, zoom 9 | 33 (30-36) | 76 (68-82) | all |
| motion, the sea crop, zoom 6 | 36 (25-45), up to 76 | 83 (58-104) | all |
| motion, the sea crop, zoom 5 | 14 (11-17), up to 71 | 15 (12-38) | 29% |
| motion, the land crop, zoom 9 | 12 (9-14) | 27 (22-32) | all |
| motion, the land crop, zoom 6 | 8 (5-13) | 13 (7-14) | 7% |
| motion, the land crop, zoom 5 | 16 (14-19) | 16 (14-19): the same wind | none |
| whole frame, the sea, zooms 4 / 5 | 9 (7-14) / 12 (9-17) | 10 (7-16) / 15 (10-33) | 12% / 30% |
| whole frame, the sea, zooms 6 / 8 / 9 / 10 | 24 (12-36) / 38 (33-41) / 32 (27-36) / 26 (23-28) | 56 / 87 / 74 / 60 | 70% / all / all / all |
| whole frame, the land, zooms 4 / 5 / 6 | 14 / 12 / 9 | 14 / 14 / 13 | 2% / 11% / 27% |
| whole frame, the land, zooms 8 / 9 / 10 | 10 / 12 / 17 | 22 / 28 / 39 | all |

The crops are the `--size 360` ones; this script reads the zoom 6 sea crop at 36 kn where the leading session reads 39 (another
crop arithmetic, not reconciled). What it changes in this log:

- **"Served" over the sea is a gale, not an everyday wind.** At zooms 6 to 10 the sea sits at 24 to 38 kn, which is beach's
  pale band (25-36 kn), where the two rows are furthest apart in colour and in alpha; at zoom 9 as served 70% of the sea is in
  that band. So the served rows already hold the pale ring, as the time-mean tables show (1.4% and 2.7% of the frame), and
  "where the eye catches it is the storm" describes the served scene.
- **"Scale 2.3" over the sea is 56 to 87 kn at zooms 6 to 10:** past the band, into speeds where the rows' alphas are equal and
  beyond the table's top. That, and not "a storm is less sensitive", is why the land row's effect on the lift fell to 2 to 3%
  there. At zooms 4 and 5 it changes 12% and 30% of the sea and little of the land; the zoom 5 land crop is the same wind in
  both scenes.
- **No row here reads the sea in an everyday wind, in motion, except the zoom 5 sea crop** (14 kn at the median: the land row
  everywhere lifts it 4% further) and, offline, zoom 4 (9 kn: 29.0% of the sea's pixels over dE00 2.3). "It weakens a breeze
  more than a gale" (the lanes section) rests on the per-knot table of one stamp, not on a moving picture: withdrawn as a
  measured statement.
- **The land rows as served are everyday winds** (8 to 17 kn): "the sea row everywhere dims the land's streaks, lift 3 to 6%
  less" was read there. At scale 2.3 the land's wind moves mainly in the views at zooms 8 to 10 and in the zoom 9 land crop, to
  22 to 39 kn: the land's own pale band, where beach's land lifts 1.0 L* (0.09 of dark's) on a ground of L* 69.9.
- **The verdict does not move:** nothing removed, nothing built. Its wording does: where this log says "in the wind as served"
  read "in the fixture as served (a hurricane: 24 to 38 kn over the sea at zooms 6 to 10, 8 to 17 kn over land)", and where it
  says "storm" or "storm strength" read "scale 2.3 (56 to 87 kn over the sea at zooms 6 to 10)".
