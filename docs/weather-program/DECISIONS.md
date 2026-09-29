# Decisions of record (append-only)

Each entry is a settled owner decision: what was decided, the evidence, and what would reopen it. **Never edit an
entry's decision text.** To change one, append a new entry that says `Supersedes D-NNN` and why; mark the old one
with a single line `Superseded by D-MMM (date)`. The newest entry is at the bottom.

---

### D-001 · Served numbers change only dark-then-flip (standing)
- **Decided:** by the owner, standing brief restated 2026-09-28/29.
- **Rule:** anything that changes a served number (surf height, rating, glyph, spot hub, sim) is built behind a
  default-off flag and flipped only on the owner's explicit word, with evidence attached (nearshore judge, skill
  ledger, shadow A/B, catalogue sweep).
- **Reopen if:** the owner says so.

### D-002 · The production frontend is frozen at `fc140024`
- **Decided:** by the owner, before 2026-09-28.
- **Consequence:** backend changes reach users only through `/surf-conditions`, `/explore/surf-spots` and
  `/conditions/batch`, and labels ride in provenance fields. Frontend fixes wait for the unfreeze.
- **Reopen if:** the owner unfreezes production.

### D-003 · ICON "Swell 2" is an intended estimate
- **Decided:** by the owner, 2026-09-25, after audit 15.0 first called it a hidden substitution.
- **Rule:** DWD GWAM has no native secondary swell, so Raw Surf estimates it (client-side blend, 60/40 GFS/EURO,
  strongest EURO cell per 0.5-degree bucket). It is a product feature, not a defect. Flag only defects inside it (a
  wrong source label, time label or capability contract), and ask before changing whether users see an "estimated"
  label.
- **Reopen if:** the owner asks.

### D-004 · The repository stays public at $0; secrets are protected by hygiene
- **Decided:** by the owner, 2026-09-24.
- **Rule:** no secret values in any tracked file (CLAUDE.md, first rule); rotation at the provider for anything ever
  committed; push protection on; a local gitleaks hook.
- **Reopen if:** the owner chooses a paid private plan.

### D-005 · No bigger Render plan
- **Decided:** by the owner, 2026-09-25/26.
- **Consequence:** the backend runs on one CPU with 2 GB. Memory headroom and CPU saturation are binding constraints
  on every feature that adds work to the box, so heavy work goes to GitHub Actions lanes.
- **Reopen if:** the owner changes the budget.

### D-006 · Serve the EQUAL GFS/EURO/ICON mean as the offshore input
- **Decided:** by the owner, 2026-09-29, after five PRs (#145, #155, #156, #158, #160) and two failed hypotheses.
- **Evidence:** the offshore skill ledger over a held-out week, ~2,800 pairs per lead (2026-09-29 02:29Z), gives
  all-sea MAE at 24/48/72 h of 0.300/0.329/0.392 m for GFS (served) and **0.282/0.304/0.337** for the equal mean. On
  big swells (3 m and up) GFS reads 0.464/0.580/0.872 and the equal mean **0.432/0.432/0.645**. Every model reads low
  on big days; ICON's high lean cancels part of that, which is why the GFS+EURO pair wins all-sea but loses big swells
  at every lead. The nearshore judge agrees.
- **Rejected:** the GFS+EURO pair (loses big swells); EURO alone (loses 24 h big and 48 h all-sea); the
  skill-weighted mean (shaves big-swell peaks).
- **Build:** dark at ingest in three PRs: A, the pure builder (#161, merged); B, pilots-lane wiring behind
  `CONSENSUS_INGEST`; C, evidence. Then the owner's flip.
- **Flip caveats** (ledger `by_band`/`by_region`, 2026-09-29 11Z): Hawaii (equal 0.532 vs GFS 0.456, ×1.18
  heights) and small seas (×1.18 median height change).
- **Reopen if:** big-swell judge days or the ledger's `by_band`/`by_region` show a clear reversal.

### D-007 · F-08 fast-path switch-off order
- **Decided:** by the owner, 2026-09-25.
- **Rule:** keep `GFS_ICON_SERIES_FASTPATH` on in Render until the ~41% of spots without NOAA/ECMWF regional
  coverage are covered. Order: Stage A (four GFS-only regions, #76, merged) → Stage B (proposal boxes 5-12) →
  Stage C (ICON/EURO for the same boxes) → route the diffuse remainder to the stored NOAA global_mid product → then
  switch the fast path off. Stage B waits on memory headroom (D-005).
- **Reopen if:** the owner reorders it.

### D-008 · Program memory lives in git (this folder)
- **Decided:** by the owner, 2026-09-29 ("sync and upgrade your memory system so that while we work, we're not
  overwriting things").
- **Rule:** the write protocol in `README.md`. Agent-local memory keeps pointers and working-style facts.
- **Reopen if:** the owner prefers another store.

### D-009 · The consensus enters as a SHADOW product first
- **Decided:** by the owner, 2026-09-29 ~14Z (asked with a recommendation; refines D-006's build plan).
- **Rule:** consensus PR B builds the equal mean at ingest as its OWN product set (model `CONSENSUS`, never
  requested by the frontend). The skill ledger grades it as a fourth lane on real buoy hours and the nearshore judge
  grades it through `/point`, so the exact built product has evidence before any user sees it, and GFS-alone stays
  intact as the baseline. The owner's flip then switches the served GFS waves to it: one switch, instant rollback.
- **Why not rewrite GFS in place:** pre-flip evidence would come only from the judge's approximation, and the ledger
  and judge would lose their GFS baseline (their equal-mean arm would count EURO and ICON twice).
- **Cost accepted:** about +5% manifest entries (~850 regional wave frames) on the memory-tight box (D-005).
- **Reopen if:** the manifest growth threatens Render memory headroom.

### D-010 · Regional wave tiles read their exact native cell (REGRID_NATIVE_CELL on)
- **Decided:** by the owner's merge of the flip PR, 2026-09-29 (the merge is the word, as with #168).
- **Rule:** every 0.25-deg regional wave node of GFS, ICON and EURO reads its own native cell; a node whose own
  cell is land answers from the sea cells of its centred 3x3. Coarser tiers are unchanged.
- **Why:** the legacy block (`half = max(1, round(res/0.25/2))` = 1) was the 2x2 of cells NORTH-WEST of every node,
  a mean placed half a cell (~14 km) off its water: our node matched Open-Meteo's NW 2x2 to 1 cm on 72% of rows
  (#170). EURO also mixed cells within one point (NW-2x2 height, own-cell direction).
- **Evidence before the flip (real GRIB, Florida east coast, run 36626767710 on #173's final code):** vector == scalar on 115,600
  values; 0 total-height values lost, 544 gained at 32 coastal nodes; heights move mean 0.024 m (p90 0.055),
  directions 5.9 deg (p90 12). Lane: `forecast-ingest.yml` + `forecast-ingest-pilots.yml` together.
- **Measure after:** the parity probe's node-vs-native gap (0.045 m before) should fall to rounding once the
  regional tiles re-ingest; the ledger's same-model gap to Open-Meteo GFS-Wave (+0.020/+0.026/+0.027 m, S2) should
  close by the same mechanism over 24-72 h of scored rows. Split ledger analyses at the flip time: the consensus
  shadow's members change with it.
- **Revert:** `REGRID_NATIVE_CELL: '0'` in BOTH lanes (or revert the flip PR); the next cycle is legacy again.
