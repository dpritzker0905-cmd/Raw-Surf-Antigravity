# 2026-11-23 · served-wave-verify-v1 build (DARK) · opus, branch `claude/served-wave-verify-archive`

Task (director session, 2026-11-22): build the served-wave point archive exactly as pre-registered in
`gates/served-wave-verify-v1.md` (#1168, advisor PASS-WITH-LIMITS at `cae692737`), DARK: nothing collects until David's word.
Read first: the gate at `cae692737` (from #1168's branch, not merged), `README.md`, LESSONS L-S29..L-S32 (from
`docs/research-lead-log-lessons-2026-11-22`, not merged), and #1156's `nearshore_lite/truth.py` / `archive.py` (read only).

## State at the end of this session
- **Nothing dispatched, no repo variable set, no bucket written.** `SERVED_WAVE_VERIFY` stays unset (= `0`): the sampler job and
  every scorer job are skipped on it, and both scripts refuse again on their own.
- **Served change: none.** The sampler only reads the published frames; nothing in `services/point_archive/` is imported by
  the serving path. No SCOREBOARD row (no served number moves).
- #1156 untouched; its alignment to the shared package (gate 0.4) is the nearshore lane's job.

## What was built
| Part | Where |
|---|---|
| Shared point archive package (core, QC, writer, storage, buoy list, cell rule, decoder bridge) | `backend/services/point_archive/` |
| Sampler (Tier A `global_mid` + Tier B assigned 0.25° box; closed-run rule; census) | `services/point_archive/served_sampler.py`, `scripts/served_wave_verify_sample.py` |
| Client decoder run unchanged in Node (data: URL import of the file's exact bytes) | `scripts/served_wave_decode.mjs`, `services/point_archive/decoder.py` |
| Scorer (join, statuses, lead bins, metrics, min n, tiers/strata/segments never pooled, exam table) | `services/point_archive/served_scorer.py`, `scripts/served_wave_verify_score.py` |
| Sampler job (`needs: ingest-pilots`, `if: always() && vars.SERVED_WAVE_VERIFY == '1'`, continue-on-error, 10 min) | `.github/workflows/forecast-ingest-pilots.yml` |
| Scorer workflow (cron `30 6 * * *` + dispatch; truth, score, verify, weekly snapshot PR) | `.github/workflows/served-wave-verify-score.yml` |
| Frozen buoy list + hash, its pool, probe catalogue, published box bounds | `gates/served-wave-verify-v1-buoys{.json,.json.sha256,.pool.json,.catalogue.json}`, `gates/served-wave-verify-v1-boxes.json` |
| Tests (52, estate lane; floor fragment +52) | `tests/test_point_archive_shared.py`, `tests/test_served_wave_*.py` |

## Reads made (all read-only; never the Render box)
- Public `weather-frames` bucket, anonymously (the client's path, L-S32 "Keys"): `v1/latest.json`; 9 indexes (to read leads,
  periods and runs); 132 regional indexes for the box bounds (`served_wave_verify_freeze_buoys.py --boxes-from-public`); 8
  Tier A frames and one `hawaii` bundle for the frozen parity fixtures (`tests/fixtures/served_wave_verify/frames/MANIFEST.json`
  records each one's index, run, valid time and sha256).
- NDBC: station page + realtime2 `.txt` + `.spec` for the 180 pool ids, one request at a time
  (`served_wave_verify_probe_buoys.py`, probed 2026-11-23T01:54:39Z).

## Measured
- Live 2026-11-22: EURO waves (ECMWF) on the 12Z run while EURO swell_1/swell_2/wind_waves (CMEMS) were on 00Z; GFS world
  frames 181 × 83 nodes (−180..180 inclusive, so the ±180° column is duplicated: the tie rule takes column 0).
- Decoder parity on the 9 frozen frames: codes equal, max |Node − frame_binary| 1.2e-5° (direction), 4.6e-7 s, 1.8e-7 m;
  the wet mask equal at every node; `decoder_version` = `git hash-object` of `ownRasterDecode.js` (`9829fe52…` at this head).
- Storage (synthetic rows at the real lead counts, real buoy list): one run of GFS + ICON + EURO = 93,936 rows, 3.31 MB
  gzipped (GFS 1.69, EURO 0.97, ICON 0.65) → **about 0.30 GB a month at 3 publishes a day, about 10.8 GB over 36 months.**

## Choices the advisor should rule on (each is a reading of the gate, not a change of it)
1. **One record per frame SET** (model, run, frame set, tier, buoy, lead), not one record per lead with the partitions riding
   in it. Section 6 lists `frame_set` per record, but section 9's estimate assumed the partitions ride along. They cannot keep
   their provenance (frame hash, grid hash, cell, status) in one record, and the sets of one model are on DIFFERENT runs
   (EURO above). Cost: the measured 0.30 GB/month is above the 120-200 MB estimate; inside the 2× pause line only against its
   upper end. The quota and cost check of section 9 is still owed before the dispatch request.
2. **When a run is written.** The file is immutable per (purpose, model, run), so a run is written when it is CLOSED: no
   expected set of that model still has a current run earlier than it, or some set holds it only as its previous index (its
   next publish prunes it). An open run waits for the next publish. A set that never published the run by then is
   `set_unpublished`. (Gate 2: "once per newly published run per model (keyed by run_hash)"; `run_hash` = SHA-256 of the sorted
   (set key, index path) pairs sampled.)
3. **Field names follow the shared core (0.2):** `station_id` (section 6 says `buoy_id`); partition values in `partitions:
   [{kind, h, tp, dir}]` (section 6 says `swell1_*`), with `period_kind` = `tp` (GFS / EURO bulk: PERPW, pp1d) or `tm` (ICON
   bulk tm10 and every partition period). Values are written at the field's quantisation step (1 mm, 0.01 s, 0.01°), i.e. the
   encoded code's value; the Float32 the client holds differs by < 1e-5 (the parity test checks the raw Float32).
4. **Scorer status mapping:** `MM` → `no_obs` / `no_report`; out of the field's range (the numeric fills) → `buoy_qc_fail` /
   `range`; stuck → `buoy_qc_fail` / `stuck`; a direction whose observed height is < 0.3 m → `low_hs` (counted, not scored);
   GFS `swell_2` → `no_truth_partition` (NDBC has one swell partition). `fetch_gap` vs `no_report` is decided from each
   snapshot's OWN span, capped at 45 d: the ECCC stations NDBC mirrors hold only ~24 h in realtime2 (probe: 11-25 rows).
5. **Score cells** are also keyed by stratum (exposed / sheltered / nearshore), `decoder_version` and `buoy_list_version`
   (sections 3, 4, 11: never pooled). Tier B is one class across boxes (never pooled with Tier A).
6. **Buoy list (for the advisor's freeze gate): 100 stations, 90 NDBC scored + 10 CDIP exam-only; 47 inside a regional box.**
   Short of the gate's targets where the pool ran out of ACTIVE stations on 2026-11-23: US East 13/15, Gulf 6/8, Hawaii NDBC
   6/8, Caribbean 5/6. No UK, Irish or Korean id reports WVHT on NDBC realtime2, so `other` got none. The remainder went
   round-robin over the regions (US West 24, Alaska 13, Canada 13, open ocean 10). Active = ≥ 20 WVHT reports in realtime2 and
   one within 3 days (a share-of-rows test fails healthy stations: met rows are every 10 min, WVHT hourly, ~0.48). A station
   whose page gives no depth is left out (it cannot show ≥ 20 m). `sheltered` is a named feature per station (pool file).
   **No station carries `nearshore_eval` yet:** four of #1156's five rules are evaluated per station
   (`nearshore_eval_checks`); the harbour rule is the nearshore lane's (0.4).
7. **Private bucket:** `point-archive` (override `POINT_ARCHIVE_BUCKET`), created NON-public by the sampler's first write
   (after David's word); `SupabaseStore.ensure_private_bucket` refuses the public frames bucket.
8. **Not built:** the dated 36-month retention prune (first due 2029); the monthly station-metadata read (section 11).
   Built but unverifiable dark: the weekly snapshot PR from the workflow (needs the repo to allow Actions to open PRs).

## Owed before the dispatch request to David (gate 9)
- Supabase storage quota and cost against ~0.30 GB/month (~10.8 GB / 36 months).
- The advisor's gate of the frozen buoy list (section 3: "before the first record").

## 2026-11-23 · advisor rulings on #1177 (relayed by the director) → amendment 1
Recorded in `gates/served-wave-verify-v1-amendment-1.md`; the choices above it stand where it does not change them.
- **A1 stuck rule:** the 6-in-a-row flag now applies to WVHT, APD, SwH and WWH only; DPD, SwP, WWP (binned) and MWD, SwD, WWD
  (binned / compass) are never flagged (`qc.STUCK_EXEMPT`). Steady-swell tests pin it (QC level and scorer level).
- **A2 §6/§9:** one record per set accepted; storage restated at ~0.30 GB/month (~10.8 GB / 36 months); the first-week pause
  line is now 2 × 0.30 = 0.60 GB/month. (My smaller-layout measurement, slim JSONL ~0.125 GB/month, columnar ~0.045, is not
  adopted.)
- **A3 snapshot PR:** opened with the PAT secret `SERVED_WAVE_VERIFY_PR_TOKEN` by name, never `GITHUB_TOKEN` (no CI would run
  on it); skipped with a warning while the secret is unset. Creating the secret is the owner's step.
- Tests 52 → 56; estate floor fragment +56. Still dark: nothing dispatched, no variable set, no bucket written.

## 2026-11-23 · director: adopt the SLIM layout now, before any data exists (folded into amendment 1, A2)
Supersedes the "(not adopted)" line of the entry above.
- `point_archive/slim.py` (`slim/1`): header (run provenance once), one line per frame, one cells line per grid snapshot,
  records keep only their own keys. Lossless: `unpack(pack(rows)) == rows` on every record shape (unit test) and on real
  sampler output read back from the stored file (sampler test). `writer.write_run` writes it; `writer.read_run_rows` and the
  scorer's `load_local` read it (plain files still read). Schema fields and the scorer unchanged. Columnar not adopted.
- Measured with the real packer on the same synthetic rows: one run of GFS + ICON + EURO = 1.41 MB (plain 3.31 MB)
  → ~0.127 GB/month, ~4.5 GB over 36 months; the first-week pause is now 2 × 0.125 = 0.25 GB/month.
- Tests 56 → 58; estate floor fragment +58.

## 2026-11-23: amendment 2, the #1199 LOCKED holdout (follow-up PR, branch claude/served-wave-verify-holdout)
- Director relayed the advisor's #1199 limit 1. The public score tables pooled ALL buoys daily, which would read #1199's LOCKED 20 % every day and void the holdout. That must be fixed before `SERVED_WAVE_VERIFY` is set.
- Built (amendment 2): `point_archive/holdout.py`, with `state()` as the only gate.
  - NOT_READ while the list's `holdout.locked_list` is null, and also when the named list is missing, fails its SHA-256, or disagrees with the `locked` tags (exit 1). NOT_READ means collect-only: no download, a NOT_READ document, nothing published.
  - Once READY: locked truth is never downloaded or opened, locked rows are dropped on load and again in `served_scorer.score`, `--publish` refuses a body naming a locked id, and every printed line is redacted. The snapshot PR commits only a `scored` document.
- Buoy list version 2: `fit_used` / `fit_used_by` / `locked`, plus a `holdout` block. It equals the v1 freeze plus the committed census, under the new `--tag` mode. `list_hash` leaves out the freeze-filled fields, so #1199's freeze makes no new version. Hash `656a7a27…`.
- Census: 26 / 100 buoys are fit_used. wave_emos_l1 has 17 listed; skill_ledger_fits has 10 of the 60 mapped buoys (one SELECT on `surf_spots.noaa_buoy_id`). OPEN: the wind / gust EMOS station set in the private bucket, whose read was denied in this session.
- Tests: `test_served_wave_holdout.py`, 14 tests, including the pin that a locked id never appears in the scored document, stdout, downloads or verify lines. The locked-excluded scores equal scoring with the buoy absent; the control is that the buoy does move the tables when it is read.
  - Mutation-checked, each going red: scorer fence off, download fence off, redact made a no-op, SHA check off, NOT_READ download allowed.
  - The suite ran twice, 72 passed both times.
- Slip: one mutation command contained a bare `python -` (house rule). It hung, was stopped with TaskStop, and the files were restored from backups and re-checked.

## 2026-11-23: amendment 3, the #1199 LOCKED fence program-wide (branch claude/locked-holdout-fence)
- Director's P0 (Fable inspection, finding 2): only the served-wave scorer filtered #1199's LOCKED buoys. The skill ledger, calibration, accuracy monitor, gust verification, EMOS and long-range wind read every buoy, and the breach would start at the freeze.
- Built `services/buoy_holdout.py` (stdlib only) with three states:
  - `none` today, an exact no-op;
  - `verified` = the locked ids plus their aliases (id, WMO id, CDIP number);
  - `quarantine` = a recorded list that does not verify, which fails closed and treats every listed buoy as locked.
- `point_archive/holdout.py` now verifies through it, so there is one implementation.
- Consults (public context only):
  - SubQ (truncated at its token cap): drop locked rows before aggregation; aliases; archives and caches; scan beyond backend/; logs.
  - Reflection: fail closed with no fallback to tags; a runtime complement to the static scan; one gateway.
  - Adopted: quarantine with no tag fallback, aliases, `allow_url` as a runtime gate in every fetch path, the workflow scan.
  - LongCat: preview only, awaiting the owner's approval of the payload hash (paid).
- Routing: three subagents with disjoint file sets plus my own edits. 54 modules call the fence; 5 are declared collectors; 14 exemptions are reviewed in the guard.
  - The guard caught one edit a subagent reported but never applied (`model_skill_census.py`); I fenced it myself, along with `euro_fallback_census.py` and `same_model_parity_probe.py`.
  - `gust_verify_score.py` was a real reader with no fence. Its stdlib-only pin now admits exactly the fence, and checks the fence itself imports only the stdlib.
- Tests:
  - `test_buoy_holdout.py`: 21.
  - `test_buoy_holdout_guard.py`: 4.
  - `test_buoy_holdout_consumers.py`: 7 runtime canaries.
  - Mutations each go red: allow_url forced open, drop made a no-op, one consumer's gate removed, aliases off.
  - The regression run over every test file naming a changed module ran twice (see the PR).

## #1199 LOCKED freeze (2026-11-23, after #1234 and #1236)
- **Rulings** (David, relayed by the director): scope "Whole buoy, all data (Recommended)"; pool "71 unfitted buoys
  (Recommended)". SubQ and Reflection reached the same pool independently. LongCat was down.
- **Draw:** `served_wave_verify_freeze_buoys.py --draw-locked` locked 15 of 71 eligible buoys: alaska 3, canada 2,
  caribbean 1, gulf 1, hawaii 1, open_ocean 2, us_east 2, us_west 3. The buoy list hash is unchanged (`656a7a27…`;
  locked fields sit outside `list_hash`). The fence state is `verified`. No LOCKED id is in any fit-used consumer set.
- **Loud quarantine:** a stderr banner, plus an `::error::` annotation in Actions. CI pins the committed record as verified.
- **Pins:** redrawing from the committed list reproduces the LOCKED file byte for byte. A changed seed, or fit_used
  buoys made eligible, each turn the pin red. `--draw-locked` refuses to run once a list is recorded.
- **Census open item** (wind/gust EMOS): resolved in the text of amendment 1 without a census change. EMOS has fit
  nothing, and a census change would move the list hash.
- **Rules:** `gates/served-wave-skill-v1-amendment-1.md`.

## Fence additions on #1234 after the merges from dev (2026-11-23)
- **`nearshore_lite/truth.py` (#1155):** fenced. `fetch_realtime` is a truth reader that the MOP-lite gate scores against.
  A LOCKED buoy now reads as missing (`None`), and the opener is never called. Station selection is unchanged (metadata).
  A canary is in `test_buoy_holdout_consumers.py`. Nothing calls `fetch_realtime` yet besides its own tests, so no
  nearshore score moves. No live lane owns #1155 / #1157 (director, 2026-11-23); the guard forces future scoring through
  the fence.
- **`scripts/admin_ops_bucket_io.py` (#1239):** EXEMPT, the 15th entry. It counts objects only and reads no observation
  value.
- **A slip:** the intermediate #1234 head `b8d8137e1` was pushed red on the guard, because the push was not gated on the
  test. It was fixed forward at `873a40438`. Pushes are now gated on the guard passing.
