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

## 0b. DECISION RULES (2026-11-16 ~05:10 EST, written before any OSM evidence exists and before the classifier has run once)

Deviations from section 0, said first:
- The validation set is **109** spots, not 120 (the river-mouth stratum has only 4 catalogue candidates). Blind labels:
  46 beach, 20 reef, 11 inlet_jetty, **6 point_headland**, 4 river_mouth, 22 unknown (20 %), committed `a9008c6c4`.
  With 6 point labels, the point precision interval will be wide; it is reported, not hidden.
- I read the labeller's SUMMARY (counts, and that five "pier" spots were labelled beach) before writing these rules. To keep
  the rules blind to it, the structure tier keeps piers exactly as section 0 registered them; nothing below was tuned on labels.

The classifier (`backend/scripts/build_spot_class.py`): the first tier that matches wins.
| tier | evidence (`spot_osm_evidence.json`, snapshot) | class | confidence |
|---|---|---|---|
| 1 | OSM breakwater / groyne / jetty / pier within 1,000 m | `inlet_jetty` | 0.85 if <= 500 m, else 0.70 |
| 1 | else an OSM river mouth within 1,000 m | `river_mouth` | 0.80 if <= 500 m, else 0.70 |
| 2 | catalogue `wave_type` (beach / sandbar -> beach; reef / slab -> reef; point -> point_headland; jetty -> inlet_jetty; river -> river_mouth) | that class | 0.70 |
| 3 | name / description keyword classes: one class | that class | 0.60 |
| 3 | several keyword classes: the first in the order inlet_jetty, river_mouth, reef, point_headland, beach | that class | 0.55 |
| 4 | OSM natural=reef within 500 m | `reef` | 0.55 |
| 4 | else OSM natural=cape / peninsula within 1,000 m | `point_headland` | 0.55 |
| 5 | `shore_normal_spread_deg` >= 60 | `point_headland` | 0.50 |
| - | none of the above | `unknown` | 0.0 |
Beach subtypes (dissipative / intermediate / reflective) are a later slope step; until then the beach group is reported as `beach`.

Scoring (`backend/scripts/score_spot_class.py`): precision and recall per class with Wilson 95 % intervals over labelled spots whose
label is not `unknown`; a classifier `unknown` counts toward the unknown share (gate: <= 30 %) and as a miss for recall, never for
precision. NULL: the classifier's outputs shuffled within country, 1,000 seeded shuffles, mean precision per gated class (gate: < 0.5).
POSITIVE comparator: the catalogue tag alone (tier 2 only), scored the same way on the spots it covers.

## 0c. Input from the repair lead (2026-11-16 ~06:00 EST; PR #969, log `2026-11-16-fable-surf-transect-a1.md`; model only)
- A Battjes-Janssen transect on a shore-normal ETOPO 2022 bed, with a CONSTANT gamma, gives almost today's breaker height (1.41 x
  offshore against 1.52) and is barely spot-aware: the breaker height sits where the wave first saturates, set by the wave, not the
  beach. So a class gets its effect only if gamma (or the input) depends on the class: a design input for B3, not a B2 change.
- The surf-zone INTERIOR differs by spot (Hs in 1 m of water 0.46-1.13 x offshore across the panel).
- The beach-subtype slope step can reuse `surf_transect.bed_from_grid`. On the six no-break-depth spots it found a usable ETOPO bed at
  five (slopes about 1:170 to 1:250); Rodanthe Pier had no fittable slope. A 463 m grid gives large-scale slopes: a tier below CUDEM,
  and recorded as such when the subtype step runs. Nothing in section 0b changes.

## 1. RESULT of the registered classifier (2026-11-16 17:53 EST by the clock): FAIL by the letter
Inputs: the 109 blind labels (a9008c6c4). OSM evidence for all 109 spots (complete, 0 failed tiles), fetched offline from public
Overpass. The full-catalogue pass is still running, slowed by a day-long Overpass overload. The catalogue snapshot is from Actions run
43871986467. Rules exactly as section 0b; nothing changed after seeing labels or evidence. Scored by score_spot_class.py.
Labelled 109, label known 87; classifier unknown share 8.3 % (limit 30 %).
| class | precision (Wilson 95 %) | recall | gate >= 0.75 | null (shuffled within country) |
|---|---|---|---|---|
| beach group | 0.906 (0.758-0.968), 29/32 | 0.63, 29/46 | pass | 0.675: FAILS the < 0.5 null |
| inlet_jetty | 0.333 (0.192-0.512), 10/30 | 0.91, 10/11 | FAIL | 0.175 |
| point_headland | 0.600 (0.231-0.882), 3/5 | 0.50, 3/6 | FAIL (n = 5) | 0.409 |
| reef | 1.000 (0.701-1.000), 9/9 | 0.45, 9/20 | pass | 0.579: FAILS the null |
| river_mouth (reported) | 0.500 (0.188-0.812), 3/6 | 0.75, 3/4 | - | - |
Comparator, the catalogue tag alone: beach 0.833, inlet_jetty 1.0 (3/3), point_headland 0.429, reef 1.0 (12/12); unknown share 36.7 %
(FAILS the 30 % limit). Confusion (label -> prediction): beach -> inlet_jetty 12, reef -> inlet_jetty 6, point -> inlet_jetty 2.
VERDICT: FAIL. B2 is NOT used by B3 or by any class factor.
What the numbers say (reading, not a re-test):
1. The structure tier over-fires. "Any breakwater / groyne / jetty / pier within 1,000 m" sends 18 non-inlet spots to inlet_jetty, so
   its precision is 0.33. This is the pier question noted in 0b before the rules ran (the labeller called most pier spots beaches),
   and the rule was left as registered on purpose.
2. The null as registered cannot pass for a class that is a large share of a country's spots. Shuffling within country keeps each
   country's class mix, so precision under the null is about that class's share: beach is 46 of 87 known labels. This is a design flaw
   in the null, found after seeing results. It does not change the verdict, and it is fixed only in a NEW registration.
3. point_headland has 5 predictions and 6 labels: too few to judge either way.
NEXT (needs a new registration and NEW labels; nothing here is re-scored on these 109):
(a) structure tier: breakwater / groyne / jetty only (no pier), within 300 m, and only with a coastline or inlet signal;
(b) a null that compares against each class's base rate (precision minus the class share);
(c) a fresh seeded sample of >= 120 spots, labelled blind, with >= 25 per gated class (oversampling point and reef).

## 2. B2 v2: PRE-REGISTRATION (2026-11-16 18:22 EST by the clock; before any v2 spot is drawn, labelled or fetched)
Asked for by the director (18:19 EST). v1 stays a FAIL (section 1); nothing from v1 feeds B3, and none of v1's 109 spots or labels is
used here. HONESTY NOTE: the rule changes below were chosen AFTER seeing v1's confusion matrix, which is exactly why v2 is scored
only on new spots, labelled blind.
### Sample (seed 20261117; ordered by md5(id || '20261117') within each frame; v1's 109 ids excluded)
Frames as in v1 (catalogue tag or keyword; a SAMPLING frame, never a label), except that "pier" no longer puts a spot in the
inlet/jetty frame. Frame sizes (whole catalogue, measured now): beach 620, inlet_jetty 39, point_headland 146, reef 163,
river_mouth 4, untagged 801. First draw: inlet_jetty all remaining; point_headland 70; reef 45; beach 40; untagged 25.
TOP-UP, fixed now: after labelling, any gated class with fewer than 25 labels gets the next 20 spots of its own frame in seed order,
repeated until it has 25 labels or the frame is exhausted. A class that cannot reach 25 is reported as UNDERPOWERED, with its
interval, and decided only by rule 2 below. River_mouth is reported, not gated (4 in the whole catalogue).
### Labels
Blind, by readers who see no classifier output and no OSM evidence, from public spot guides and imagery, with sources. Where
sources disagree: unknown, excluded from precision. Committed before any evidence for these spots is fetched.
### Classifier v2 (uild_spot_class.py, rules fixed now; the first matching tier wins)
| tier | evidence | class | confidence |
|---|---|---|---|
| 1a | OSM breakwater / groyne / jetty (NOT pier) within 300 m AND an inlet signal: an OSM river mouth within 1 km, OR the name matches inlet / jetty / groyne / groin / breakwater, OR the catalogue tag is jetty | inlet_jetty | 0.80 |
| 1b | else an OSM river mouth within 500 m | river_mouth | 0.75 |
| 2 | catalogue wave_type (as v1) | that class | 0.70 |
| 3 | keyword classes as v1, except that inlet_jetty counts only when the NAME matches inlet / jetty / groyne / groin / breakwater (a pier alone gives no class) | that class | 0.60 / 0.55 |
| 4 | OSM natural=reef within 500 m -> reef; else natural=cape / peninsula within 1 km -> point_headland | | 0.55 |
| 5 | shore_normal_spread_deg >= 60 -> point_headland | | 0.50 |
| - | none | unknown | 0 |
### Gate (per gated class: the beach group, inlet_jetty, point_headland, reef)
1. Precision >= 0.75, AND
2. the Wilson 95 % LOWER bound of precision is above the class's BASE RATE (its share of the known labels in v2): the classifier
   beats choosing that class by chance. This base-rate-relative rule replaces v1's "null < 0.5", which a large class could never pass.
3. At most 30 % of the labelled spots left unknown by the classifier.
B2 PASSES only if every gated class passes 1-2 (an UNDERPOWERED class: rule 2 only, and flagged) and rule 3 holds.
Reported, not gated:
- the within-country shuffle null as a sanity check (its mean precision minus the base rate, expected ~0);
- recall and the confusion matrix;
- the catalogue tag alone as comparator;
- river_mouth.
Nothing reads B2 for a served number unless it passes; B3 and any class factor carry their own gates.

### 2a. Amendment (2026-11-16 19:08 EST by the clock; the advisor's read at 23:37Z; before any v2 label exists)
Disclosure: a labelling agent started at ~18:25 EST under section 2 and was STOPPED at ~19:08 EST on the advisor's hold. It wrote no
label file and committed nothing. It may have run the read-only draw query, which is deterministic and changes nothing. Any partial
labels it held are discarded and none is used. Changes to section 2:
1. WEIGHTED GATE. Each spot carries weight = (its frame's size) / (that frame's sample size). Frame size = active catalogue spots in
   that frame, v1's 109 excluded, counted at draw time. Precision, the base rate and the unknown share are computed WEIGHTED, and
   those decide the gate; the raw values are reported beside them. Intervals: a stratified bootstrap (resampling within each frame,
   2,000 resamples, seed 20261117), not Wilson. Gate rule 2 becomes: the bootstrap lower bound of weighted precision is above the
   weighted base rate.
2. UNTAGGED DRAW raised from 25 to 80 (seed order), so the half of the catalogue where the classifier adds most is not starved.
3. WHAT 25 COUNTS. The top-up still counts LABELS (it never depends on classifier output). The evidence for a batch is fetched only
   after that batch's labels are committed. The minimum for a gated verdict is 25 spots PREDICTED in that class (raw count).
4. An UNDERPOWERED class (fewer than 25 predicted) is UNDETERMINED: it cannot pass. B2 can pass for the other gated classes with that
   class named as undetermined, and nothing reads an undetermined class.
5. LABELS NOT FROM THE NAME. A label needs a guide's description of the break and/or imagery. The source type is recorded per label
   (guide_description / imagery / both). A name alone gives unknown. A SECOND blind reader labels a fixed seeded subset: the 30
   labelled spots first by md5(id || '20261117-agree'), without seeing the first reader's labels. Raw agreement and Cohen's kappa are
   reported; disagreements stay with the first reader's label and are listed.
Also reported: precision BY FRAME, because inside a tagged frame the classifier is mostly the catalogue tag.
2a, the advisor's two conditions (2026-11-16 19:29 EST by the clock; the advisor confirmed 2a at 00:27Z):
- The stopped agent fetched NO classifier evidence. Its transcript has no Overpass, no spot_class_osm, no openstreetmap.org and no
  SQL-tool call. It left one scratch file outside the repo: its draw output (291 rows of frame / id / name / position; no label, no
  source). That file is DELETED, unread, before the fresh reader starts. No partial label of that agent exists anywhere a reader can
  reach.
- The labels are made by a FRESH reader (a new agent with no access to the stopped agent's context). It draws again from the amended
  query (untagged 80).
