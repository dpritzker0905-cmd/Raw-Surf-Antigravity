# TRUTH FIRST: building our own nearshore surf truth (research lead, 2026-11-19)

**Owner word (David, in the research lead's session):** "Yes, truth first". This is step 0 of
`best-sota-path-synthesis-2026-11-19.md`.

**Why first:** we have n = 0 usable surf observations. blind_v1 has 0 rows; the legacy reports are non-blind staff/test
data.
- Without truth we own, no nearshore method (MOP, NWPS teacher, physics K, per-site bias) can be certified "better"
  anywhere.
- About half the catalogue has no agency nearshore model.
- California's independent truth is thin, because nearly every buoy there is Scripps.

## Streams, in priority order
### S1. Blind check-ins (blind_v1): finish and launch (surf-truth lane)
- **Land the queued pieces:** consent and export (#1026 / #1034), with #1024 already merged.
- **Seed anchors at pilot spots:**
  - human-verified pins first (only 20 of 1,773 are verified);
  - start where truth matters most: NE Florida (the over-read), SoCal (MOP re-judge), Oahu, and 2-3 European spots.
- **The form records:**
  - numeric size on a STATED scale (face or Hawaiian, per the D-078 regional rule);
  - quality;
  - observed time;
  - distance band;
  - blind entry, with no forecast shown before submit.
- **Incentive and volume:**
  - use the existing photographer and gamification flow (T1 design);
  - target a pre-registered minimum: ≥ 200 blind reports per region over ≥ 10 three-day blocks before any gate reads
    them.
- **Quality model:** the latent-truth / rater-effect model already designed (T1 prereg lineage), with shuffled-ID and
  planted +30% controls.

### S2. Surf-cam height extraction (NEW lane; evaluation first, nothing served)
- **Licence first:** only cameras whose terms allow automated analysis for a commercial app (owned or partnered cams,
  or explicitly open public-agency cams). Commercial surf-cam networks are EXCLUDED unless their written terms allow it.
- **Method to evaluate:** breaking-wave height from video using known reference scale (pier pilings, a measured
  horizon distance) and timestack / breaker-tracking (the established coastal-imaging approach).
- **Validation:** against CDIP buoys and MOP points as the EXAM. California has both cams and CDIP, so it is the
  calibration lab. Then transfer to cams with no buoy.
- **Gate:** cam-derived face height vs CDIP-derived breaking height, MAE + ME, ≥ 10 three-day blocks, and a planted
  scale error that must be detected.
- **Status:** the cams must be identified and licence-checked before anything is built.

### S3. External truth meanwhile (no waiting)
- NDBC / NOAA-owned buoys and CMEMS in-situ: offshore inputs, plus period and wind (3b).
- CDIP + MOP: the EXAM only.
- Sentinel-2 / Sentinel-1: ordinal size; period and direction.
- NWPS: the independent model check (row 19).

## What changes downstream
- Steps 4 (transfer K) and 5 (per-site bias) keep their designs, but their gates wait for S1/S2 volume in their
  regions. Until then they report "insufficient".
- The MOP re-judge moves to S1/S2 truth as soon as the minimum is met (its 60-day clause).
- Step 6 (uncertainty) stays on input-verified levels until S1 exists.

## Owners (proposed; the director routes)
- S1: the surf-truth lane (already owns blind_v1).
- S2: a new imaging lane, with licence research first.
- S3: the existing lanes.
- The research lead: pre-registrations and minimums for S1 and S2.
