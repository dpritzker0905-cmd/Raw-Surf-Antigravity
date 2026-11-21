# T2: Sentinel-2 surf zones as a worldwide breaking-zone truth source (plan + PRE-REGISTRATION, drafted 2026-11-15 ~22:45 EST, committed 2026-11-16 before any scene is fetched or processed)

Assigned by the director (David 22:15 EST: "innovate free ways... dig deeper"; FRF dropped). Written in the quiet window: no runs.
Runs only in GitHub Actions, never on Render. Citations: the research lead's plan (PR #929 log); Frugier 2026 for state/slope.

## What it can and cannot give (said first)
- It CAN give, per spot and per scene: the surf-zone WIDTH (the outer breaking line to the shoreline, from visible foam), the
  beach STATE and an effective SLOPE (width against the breaking depth implied by the offshore sea and the tide).
- It CANNOT give a breaker HEIGHT directly. Height enters only through a model (the breaking depth h_b = H_b / gamma and
  the slope). So T2 checks the TRANSFORM's geometry and dissipation (where waves break, how wide the zone is) and feeds B2 classes
  and B3 slope. It is NOT a height truth, and must never be reported as one.
- Bias: daytime, cloud-free, visible foam only. Small days leave no foam line, so the sample leans to bigger days and to
  wide dissipative zones. Reported per class, never pooled away.

## Pipeline (Actions, per region, cached as artifacts)
1. Scenes: Sentinel-2 L2A from the Copernicus Data Space (free; the licence allows commercial use), 10 m bands B2/B3/B4/B8, 2016-
   2026, cloud < 20 % over a 2 km box per spot, scene-classification mask applied. Budget per run capped; regions in turn.
2. Detection per scene: water/land (NDWI on B3/B8) -> shoreline; foam (high B2-B4 reflectance over water, connected to shore) ->
   the outer breaking line; surf-zone width = the distance along the spot's shore normal (`resolve_surf_geometry`) between them, a
   median over a 300 m alongshore window. Quality flags: no foam, foam not connected to shore, swash only.
3. Pairing: each scene's acquisition time -> our stored HINDCAST offshore Hs/Tp/direction at the spot (the archived run nearest
   before the time, shortest lead) and the tide (the tide model the chain already uses). Never the live box.
4. Output per spot: scenes used, width distribution, the fitted effective slope, and the (offshore, width) pairs, with flags.

## How it feeds B2 / B3
- B2: beach state (dissipative / intermediate / reflective) from width against Hs and slope (the Iribarren and Dean-number
  classes), as evidence beside ETOPO slope; a reef or point shows as a narrow, angle-dependent foam line.
- B3: the effective slope where ETOPO cannot resolve one (most beaches); a check that a per-spot transfer puts breaking at the
  observed distance from shore for the observed sea.

## PRE-REGISTRATION (committed 2026-11-16, before any scene is fetched or processed)
- Detection validity (before any science): on >= 50 scenes hand-traced (seeded sample, >= 5 regions), the detected breaking line
  within 30 m (3 pixels) of the hand trace in >= 80 % of scenes; null control: the same detector on scenes with Hs < 0.3 m
  (no expected foam) flags "no foam" in >= 80 %; positive control: a synthetic foam band inserted at a known distance is
  recovered within 1 pixel.
- Science gate (only if detection passes): held-out SPOTS by region and class; the width predicted by the chain's breaking depth
  and the fitted slope explains the observed width better than the class-median width alone (lower MAE, block bootstrap over
  spots); shuffled-class null shows no gain; no class worse.
- Reported limits: per class and region, the share of scenes usable, the Hs distribution of usable vs all scenes (the big-day
  bias), cloud loss, and spots with zero usable scenes.

## Ownership
B2 (classes) and T2 run in parallel; T2's first deliverable is the detection-validity gate on the Florida east coast and
California (the pilot coasts, where hand-tracing and CUDEM slopes exist). Built after 00:30, in Actions.
