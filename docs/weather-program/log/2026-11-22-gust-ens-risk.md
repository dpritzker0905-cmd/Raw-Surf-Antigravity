# 2026-11-22 · gust-ens-risk (ensemble gust exceedance, review rank 3)

Session: side session of the director (`local_d6b521eb`), started from `local_7f4942af` (gust lanes). Brief: build
an ensemble gust-risk product, P(gust >= 25 / 34 / 48 kn) from the ECMWF open-data ENS `10fg`; pre-register, build
the publisher dark, score on a hindcast, and only then a client view.

## 2026-11-23 02:10Z · measured before writing the gate
- `memory_audit.py --docs-only`: 0 FAIL. The open gust commitment (`claude--gust-verify-f27efa.jsonl:3`, re-score
  due 12-09) is #1063's; nothing overdue is this lane's.
- #939 is CLOSED (its hindcast run 44376282465 FAIL on wind; condition (2) blinding still binds). #946 (instrument),
  #950/#951 (EMOS) are merged. The fetch/decode to reuse is `ens_wind_fetch.fetch_step` + `ens_wind_core`.
- **`10fg` window, decoded from GRIB headers (run 2026-10-15 00Z, `enfo` and `oper` alike):** steps 3-90 h carry
  `10fg` with a **1 h** window (step 24 = max over 23-24 h); 93-144 h carry `10fg3` (3 h); 150-360 h `10fg` (6 h).
  The brief's "3 h / 6 h" and `ens_wind_core`'s docstring ("6 h past 144 h") are right past 144 h, but up to 90 h
  the ENS gust is a 1 h max taken every 3 h. `ens_wind_fetch.PARAMS` has no `10fg3`, so 93-144 h need it named.
- Member messages are 1.29-1.43 MB (CCSDS, 1440 x 721); 50 `pf` per step (no `cf` since 2026-05-13).
- IEM `asos.py` serves the METAR `PK WND` remark (`peak_wind_gust`, `peak_wind_time`; BOS 2026-11-05 shows 26-33 kt
  peaks with their minute). That gives the METAR hourly peak above 25 kt, not only the 10-min gust group.
- Local AWS read speed ~14 MB/s on one connection (71 MB in 5 s); eccodes 2.50.0 installs and decodes locally.

## 2026-11-23 02:50Z · gate written: `gates/gust-ens-risk-v1.md`
Fresh collection (none of #946's files), 42 00Z runs 2026-10-10..11-20, 21 lead steps in four bins that follow the
window changes, NDBC + coastal ASOS truth with the `PK WND` peak, CLIM (leave-one-day-out) and HRES 0/1 as
comparators; G1-G4 per threshold x bin, controls C1-C4 (VOID on failure); product scope follows the passing cells,
minimum 25 kn in B1 and B2. Committed before any model value or truth is read.

## 2026-11-23 03:38Z · GO, the director's directive, and amendment 1 (before any score)
- **David's word, relayed by the director (`local_d6b521eb`):** "Yes, run both", typed in the director session ~03:01Z,
  confirming "Yes, run the 62 GB gust hindcast" in the advisor session. Scope: gate section 10 only. The daily
  publisher (~6 GB a day) is NOT covered; #1202 is HELD.
- **Order, disclosed:** the station freeze and truth snapshot ran 03:10-03:12Z. Collection started ~03:17Z, after
  David's word, but before this session had read the GO or the advisor's order (#1195 merged first). Messages from
  the gust lane (`local_7f4942af`, "pre-registration only") and an earlier director "STOP" were queued behind that start.
  The director's latest message holds: collecting may continue, no score until #1195 merges carrying the frozen
  inputs. #1202 is held and stays open (not closed).
- **What was looked at:** one run file's format only (shapes; the max member value; five HRES and five member-mean values).
  No pairing with any observation, and no count or score.
- **Amendment 1** (`gates/gust-ens-risk-v1-amendment-1.md`):
  - 10,000 reps;
  - one primary P1 = the Brier difference vs CLIM, plus the reliability condition, under BOTH the day-block and the
    station-cluster bootstrap; G2, G4 and the 5-day blocks are reported only;
  - n fixed by a count-only table committed before the score;
  - #1199 LOCKED buoys are dropped before any row, and fit-used stations never decide;
  - October monthly stdmet named as a sensitivity only;
  - "recorded, not a claim" until the gust EMOS score after 12-09;
  - egress measured from the indices.
- **Frozen inputs committed** (`evidence/gust-ens-risk-2026-11-23/`):
  - station list (390 NDBC/C-MAN + 60 ASOS): committed (LF) sha256 `a7c01e4b558d61b993e479b39e69134becf667bab16b51e9ecfcce39dcdad8e4`;
    the CRLF original the collector read is `f6cc0720076692778ca29e7e07f0fc440140ab6d5769f4a708fad1f6bc8bb636`;
  - `truth.json`, whose snapshot hash is `19cbc5064d66722e8e61abb759582d85195eb3fc828640a675ff036125a5e505`
    (768 files, end 02:42Z).
- **Raw truth tarball:** in the shared notes folder of `local_7f4942af`, `gust-ens-risk-truth-2026-11-23.tar.gz`,
  38,575,905 B, sha256 `0b2fce07590bf6373f2527ae8b2e3633af905f7fd36ad0a592366c8bd627d55a`.
- **Freeze reads disclosed:** the freeze read every NDBC candidate's realtime2 file to count coverage, before any #1199
  LOCKED list existed.
