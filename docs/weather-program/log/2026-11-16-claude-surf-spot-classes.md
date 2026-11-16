# 2026-11-16: B2, a class for every surf spot (claude, rating band lane)

Assigned by the director (2026-11-15 19:27 EST relay of David: "we need the surf estimates fixed too ... for each surf spot
worldwide"), from the senior research lead's plan (PR #929 log, S1). Builds on the repair lead's S0 ablation (#942) and its live
panel (#963). Design notes: shared notes `B2-SPOT-CLASS-SCHEMA-2026-11-15.md`.

Why classes: today the chain has no spot class. With the same sea at every spot, 27 of 30 panel spots read exactly 1.47 x
offshore (Pipeline, Steamer Lane, Duck, Cocoa Beach Pier, Galveston alike); the only differences are three hand-set inlet
"magnets" (one constant, 1.40). The angle penalty is one curve everywhere (median 0.81 at the CDIP stations). Six panel spots
have no break depth at all.

## 0. PRE-REGISTRATION (2026-11-16 ~04:15 EST, before any classifier code or any classification is run)

### The classes (one primary class + a confidence in [0, 1])
`beach_dissipative`, `beach_intermediate`, `beach_reflective`, `point_headland`, `reef`, `inlet_jetty`, `river_mouth`, and
`unknown` (confidence < 0.5: the chain keeps today's behaviour). Beach subtypes come from slope + Iribarren only, never from a tag.

### Evidence, strongest first (precedence when evidence conflicts)
hand label > structure (OSM breakwater / groyne / pier / jetty within 1 km, or a river ending at the coast within 1 km) >
catalogue `wave_type` > name/description keywords > ETOPO / CUDEM slope (beach subtypes) > shore-normal spread (headland hint).

### The validation set (chosen NOW, labelled BEFORE the classifier runs, blind to its output)
- 120 spots drawn from the active catalogue with a fixed seed (20261116), stratified: 15 per class target for the 7 classes
  (the strata come from the CATALOGUE tag or a keyword, which is a sampling frame only, not the label), spread over >= 6 regions
  (US East, US West, Hawaii, Europe Atlantic, Australia, Central/South America, Asia), plus 15 untagged spots at random.
- Each spot is labelled from public spot guides and satellite imagery by a reader who has not seen the classifier's output, with
  the source recorded per label. Where sources disagree, the label is `unknown` and the spot is excluded from precision.
- The labelled set is committed (spot id, label, source) before the classifier code is written.

### The gate (validation only; no served number changes in B2)
- Per class: precision and recall with Wilson 95 % intervals on the labelled set, the confusion matrix, and the share left
  `unknown`. Reported for every class, good or bad.
- PASS for B2 to be USED by B3 and any class factor: precision >= 0.75 for `inlet_jetty`, `point_headland`, `reef` and the beach
  group as a whole (beach subtypes are reported but not gated: they have no ground truth beyond slope); at most 30 % of the
  labelled spots `unknown`.
- NULL control: the same scoring with the labels shuffled within region must fall below 0.5 precision for every gated class
  (the gate can tell a real classifier from chance).
- POSITIVE control: the catalogue's own tag, scored the same way on the tagged subset, is reported beside the classifier (a
  classifier that only re-reads the tag is not credited beyond it).
- The six spots with no break depth (St. Augustine point, New Smyrna Beach Inlet, Duck, Rodanthe Pier, Cape Hatteras
  Lighthouse, South Padre Jetties) are listed with their class, evidence and confidence; none borrows a neighbour's depth.

### Output and rules
- `backend/data/spot_class.json` (spot id -> class, confidence, evidence), built by a script; a CI parity test pins it to the
  script; `surf_point.resolve_surf_geometry` exposes `spot_class` / `spot_class_conf` (lookup by spot id, else the nearest spot
  within 2 km, else `unknown`). In B2 nothing reads it for a served number (no `SCOREBOARD` row needed); B3 and any class
  factor will, under their own gates (fitted shoreward of the buoy, on breaking truth only).
- OSM and slope extraction run in GitHub Actions or offline, never on the Render box. Repo PUBLIC: no secrets.
