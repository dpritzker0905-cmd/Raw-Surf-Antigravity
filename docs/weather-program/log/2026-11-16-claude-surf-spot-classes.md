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
### Classifier v2 (`build_spot_class.py, rules fixed now; the first matching tier wins)
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
2b. Label completion pass (2026-11-16 21:07 EST by the clock; registered before it runs, and still before any v2 evidence exists)
The first reader committed 266 labelled rows (9195fbccd): 171 labels, all guide descriptions, none from a name alone; 95 unknown
(27 CONFLICT, 67 NO_SOURCE, 1 NAME_ONLY). It reported that its web-search budget ran out with 27 spots never properly researched.
Those cannot be told apart from the 40 searched without a result: all 67 carry NO_SOURCE. RULE: a FRESH reader (same 2a source
rules, blind to the classifier and to any evidence, and not shown the first reader's other labels) re-researches all 67 NO_SOURCE
rows. A row changes only where it finds a guide description or imagery of the break; otherwise it stays unknown. CONFLICT and
NAME_ONLY rows are not touched. Changed rows are marked "completion_pass": true. The second blind reader (2a point 5) runs AFTER this
pass, on the 30 spots first by md5(id || '20261117-agree') among the rows with a non-unknown label.
Also noted from the first reader:
- inlet_jetty has 22 labels and no reserve (frame size 31), so it is below 25 labels. Its verdict needs 25 PREDICTED and will be
  UNDETERMINED unless the classifier predicts it 25 times.
- The river_mouth frame is empty after the v1 exclusion.
2c. Labels final, and the second reader (2026-11-16 21:52 EST by the clock; before any v2 score)
Final labels (56905fdef): 266 rows, 179 labelled. Beach 60, reef 57, point_headland 38, inlet_jetty 23, river_mouth 1, unknown 87.
The completion pass (2b) found a description for 8 of the 67 NO_SOURCE rows; most of the other 59 look like bathing sites rather
than surf breaks. inlet_jetty: 23 labels, and its frame (31) is exhausted.
Second blind reader (2a point 5), on the 30 labelled spots first by md5(id || '20261117-agree'); it saw identities only, never the
first reader's labels (`backend/data/spot_class_labels_v2_second_reader.json):
- Raw agreement 24 / 30 = 0.80; Cohen's kappa 0.75.
- Where the second reader gave a label (25 spots): 24 / 25 agree.
- Disagreements: Mughsail beach -> unknown; Cape San Blas point -> unknown; Buchupureo point -> unknown; Nuqui river_mouth -> unknown;
  Makapuu beach -> unknown; Jetty East inlet_jetty -> beach (the one direct contradiction: no source says the jetty shapes it).
- As registered, the first reader's labels stand.
Evidence for the v2 spots is being fetched only now, after these labels were committed.

## 3. B2 v2 RESULT (2026-11-17 01:30 EST by the clock): FAIL under the registered gate
Inputs: the final labels (56905fdef, 266 rows, 179 labelled) and OSM evidence for all 266 v2 spots (complete, 0 failed tiles; fetched
only after the labels were committed). The classifier is classify_v2 (section 2 rules), scored by score_v2 (2a: frame weights,
stratified bootstrap, seed 20261117). Rules and gate unchanged since registration.
| class | predicted | weighted precision (bootstrap 95 %) | weighted base | raw precision | raw recall | verdict |
|---|---|---|---|---|---|---|
| beach group | 38 | 0.901 (0.791-0.983) | 0.584 | 0.763 (29/38) | 29/60 | PASS |
| reef | 38 | 0.834 (0.684-0.960) | 0.254 | 0.868 (33/38) | 33/57 | PASS |
| point_headland | 49 | 0.549 (0.384-0.741) | 0.098 | 0.653 (32/49) | 32/38 | FAIL (< 0.75) |
| inlet_jetty | 20 | 0.800 (0.611-0.955) | 0.054 | 0.800 (16/20) | 16/23 | UNDETERMINED (< 25 predicted) |
Unknown share: weighted 0.384, raw 0.244. FAILS the 30 % limit on the weighted figure, which decides.
OVERALL: FAIL. Nothing reads B2; B3 and any class factor stay without classes.
Precision by frame (raw; inside a tagged frame the classifier is mostly the tag):
- beach frame: beach 25/27.
- inlet frame: inlet_jetty 16/20, beach 2/6.
- point frame: point_headland 31/45, beach 2/4.
- reef frame: reef 32/36.
- untagged frame (786 spots, 80 sampled): point_headland 1/4, reef 1/2; everything else unknown.
Confusion, main errors: reef -> point_headland 13; beach -> unknown 17; reef -> unknown 9; inlet_jetty -> beach 5; beach -> inlet_jetty 4.
Comparator, the catalogue tag alone: beach 0.920, point 0.767, reef 0.886 (all PASS weighted), inlet UNDETERMINED (9 predicted),
unknown share 0.591 weighted: FAIL. So the classifier beats the tag on coverage (0.384 against 0.591 unknown) but loses point
precision (0.549 against 0.767): its OSM cape / spread tiers call reefs points.
Second reader (2c): agreement 0.80, kappa 0.75.
Null sanity, within-country shuffle, raw (reported, not gated): mean precision minus base rate is beach +0.14, inlet +0.22,
point +0.21, reef +0.21. That is not about 0, because the shuffle keeps each country's class mix. As found in v1, this null is not
a chance baseline here; the base-rate rule in the gate is.
Reading (not a re-test):
(1) Removing piers fixed inlet_jetty (v1 0.33, now 0.80), but there are too few to judge.
(2) The point failure comes from tiers 4-5 (OSM cape within 1 km, shore-normal spread >= 60 deg) firing on reefs.
(3) The unknown share fails because the untagged half of the catalogue is mostly unknown, and weighting counts it at its true size.
Any v3 needs a new registration and new labels again.

### 3a. Additions after the advisor's read (2026-11-17 01:38 EST by the clock; the advisor 06:39Z; the verdict is unchanged: FAIL)
1. RECOMPUTABLE FROM THE REPO. Committed: `backend/data/spot_class_v2_predictions.json (per spot: frame, frame size, label, predicted
   class, confidence, the tier that fired, and the tag-only prediction), spot_class_v2_osm_evidence.json (the OSM distances, ODbL)
   and spot_class_v2_snapshot.json (the 266 spots' catalogue rows). sha256: snapshot c5d2dcbe3946c1f5..., evidence
   c41c262072479c29..., predictions 460182a47f0b8536... (the predictions file carries the full hashes of the other two).
   Tiers fired: catalogue_tag 135, none 65, keyword 36, osm_cape 9, osm_river_mouth 8, osm_structure_inlet 8, osm_reef 3, keywords 2,
   spread 0.
2. HOW MUCH HAS NO TRUTH. 87 of 266 drawn spots carry no label, because no guide describes the break: 0.327 raw, 0.400 WEIGHTED.
   Every precision here is measured on DOCUMENTED spots. The undocumented ones, most of the untagged half of the catalogue, are where
   a classifier is most needed and least tested. Even a future PASS could claim nothing about them. This is a different number from
   the classifier's own unknown share (0.384 weighted).
3. WHAT THE SECOND READER SAYS. Five of the six disagreements are label against unknown, where the second reader found no source and
   the first gave a class. Only one is class against class (Jetty East: inlet_jetty / beach). So where both readers found a source,
   they agree almost always (24 of 25), but WHETHER a source exists is soft, about one spot in six. The five, with the first reader's
   source type (each guide_description, 2 sources): Makapuu (beach), Cape San Blas (point), Buchupureo (point), Nuqui (river_mouth),
   Mughsail (beach).
CORRECTION to section 3's reading (2), my error: the point failure does NOT come mainly from tiers 4-5. Of the 13 reef ->
point_headland errors, 12 sit in the point FRAME and come from the catalogue tag (6) or a "point" keyword (6); only 1 is the OSM cape
tier, and the spread tier fired nowhere. These are spots tagged or named "point" that guides describe as reef breaks. The cause is
the catalogue's own tag and keywords, not the OSM tiers. (All wrong point calls: tag 7, keyword 7, cape 3.)
FACTS FOR ANY v3 (the advisor):
- The inlet frame is USED UP: 31 spots, all 31 drawn in v2, so there are none left to label fresh. inlet_jetty cannot be tested
  again on new labels unless the catalogue grows or untagged spots are searched for inlets. A v3 must not quietly reuse them.
- A v3 designed on v2's errors is designed on v2's labels, exactly as v2 was on v1's. It needs the same honesty note and only spots
  in neither v1 nor v2. Remaining unseen: point frame 61, reef frame 103, untagged 706.
3b. Recomputed independently (the advisor, 06:42Z, own stdlib code from the committed predictions): every figure matches to the digit,
intervals included; both file hashes match. Two lines added on the advisor's read (01:42 EST by the clock):
- RULE 3 HAS TWO READINGS of "at most 30 % of the labelled spots left unknown by the classifier", and they are not settled after
  the result. Over all 266 DRAWN spots: 0.244 raw, 0.384 weighted (my reading when scoring). Over the 179 spots with a KNOWN label:
  0.173 raw, 0.305 weighted (bootstrap 0.232-0.375; the advisor's reading). Both exceed 0.30 weighted, so rule 3 FAILS on either
  reading, and point_headland fails regardless. The near miss (0.305) is printed beside the clear miss (0.384).
- WHERE THE UNKNOWNS ARE: all 65 classifier-unknown spots are in the untagged frame (65 of its 80 sampled; 0 in any other frame).
  Outside that frame the classifier adds nothing a tag does not already give. Inside it, it classifies 15 of 80. That is the size of
  the problem any v3 has to solve.
