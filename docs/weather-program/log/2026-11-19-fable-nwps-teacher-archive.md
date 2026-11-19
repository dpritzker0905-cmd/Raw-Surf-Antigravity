# 2026-11-19 Fable: a collector that keeps NOAA's nearshore wave forecasts (the teacher archive; step 4)

Session: Fable repair lead (`e372475c`). Branch `fable/nwps-teacher-archive`, cut from `dev` at `ce85ccb62`.
A collector, its storage script, a workflow that does not start itself, and tests. It serves nothing, calls nothing
of the Raw Surf backend, and writes no manifest or product. No served number moves. Nothing dispatched, nothing fetched.

## 2026-11-19 01:03Z What was done, and why

**Asked for** by the director, relaying the owner's word typed in the DIRECTOR'S session (about 00:35Z, quoted to me
verbatim): "Yes to 3b, start the NWPS archive , but if we can be more SOTA than NOAA , we need to use their forecast
to help us, not just parrot what they say". I did not witness it; it is a relay. I built the collector and opened the
PR. I do not merge it and I do not start it: the director starts it after merge on that word.

**Why an archive.** NOAA's Nearshore Wave Prediction System runs a nearshore wave model per coastal forecast office
and publishes it openly, for about five days (read from its server today: daily folders per region, kept five days).
It is the teacher for the per-spot nearshore transfer: we learn from it and never serve it. Learning needs a season of
history, and that history exists only if we keep it.

**What I read on NOAA's server** (2026-11-18 folders, one office): folders by region (`ar`, `er`, `pr`, `sr`, `wr`),
then office, then cycle (`00`, `06`, `12`), then grid (`CG0` to `CG3`). The outer-grid file
`nwps.t12z.cg1.lox.grib2` was 25 MB. Each cycle also carries full directional spectra at buoy points (about 1 MB each)
and rip-current and run-up text products; those are NOT collected by this PR.

**The collector** (`backend/scripts/nwps_teacher_archive.py`, standard library only):
- For each office and cycle still on the server and not yet stored, it downloads the outer-grid file and keeps the
  GRIB2 messages whose lead time is at or under 12 hours, byte for byte. Only whole messages are dropped.
- It decodes nothing. A GRIB2 message states its own length, and the lead time sits at fixed octets of its product
  section, so the split is done on the bytes. A message whose lead can not be read is KEPT and counted.
- Beside each kept file it writes an index: the source address, both checksums, message counts, a count of kept
  fields by GRIB code, the retrieval time and the NOAA attribution.
- Two caps per run: 200 MB added to the bucket, 2,500 MB pulled from NOAA. At a cap the run stops and reports what is
  left. The office order rotates by date. One request at a time with a pause. Kill: `NWPS_TEACHER_ARCHIVE=0`.

**Storage** (`backend/scripts/nwps_archive_bucket_io.py`, standard library only, run as `python3 -I -S`): the only
code that holds the storage key. It lists what is stored and uploads create-only; an index is never uploaded without
its data. Objects go under `calibration/nwps_teacher/v1/<day>/<office>/`, a namespaced key the product clean-up never
looks at (a test pins that no archive key is a product name).

**The workflow** (`.github/workflows/nwps-teacher-archive.yml`): daily at 13:23 UTC, but the job runs only by hand or
when the repository variable `NWPS_TEACHER_ARCHIVE` is `1`. Merging it starts nothing. The key is in the environment
of the two storage steps only; the collector step installs nothing.

## Checks

- `tests/test_nwps_teacher_archive.py`: 27 passed locally. CI lint gate clean. The local interpreter is not the
  declared environment; hosted CI is the authority.
- NOT DONE: no run against NOAA's real server. The lead-time octets are taken from the GRIB2 layout and tested on
  synthetic messages built to that layout. The first real run shows whether NOAA's files match: its index records
  `unknown_lead` and `unparsed_tail_bytes`, and both should be 0.
- NOT MEASURED: how many megabytes one real cycle keeps at 12 hours. The 12 hours and both caps are my choices.

## Expected first run (written before it runs)

Per office and cycle: a kept file of a few megabytes (12 of roughly 145 hourly leads of a 25 MB file, if the fields
are hourly), `unknown_lead` 0, `unparsed_tail_bytes` 0, and a field count that names the wave height, period and
direction codes. If `unknown_lead` equals `messages`, NOAA uses a product template whose lead is elsewhere and the
keep rule is not working: the run then keeps whole files and hits the cap early, which is visible, not silent.

## What this is not

Not the teacher fit, not a served number, and not a claim that NOAA's nearshore model is better than our chain. The
step 4 pre-registration will require our chain to beat BOTH NOAA's nearshore forecast as published AND our current
chain, on buoys held out from the fit.

## 2026-11-19 01:15Z Amended before merge: every grid, and the spectra

**Asked for by the director** on reading #1090: "CG1 only is NOT enough for the purpose. The teacher is meant to show
the per-spot nearshore transfer, and CG1 (500 m to 1.8 km) is too coarse at the break. The value is in the nested
grids." Three changes, all made:

1. **Every grid an office publishes is kept**, not only the outer one: the collector lists each cycle's grid folders
   (`CG1`, `CG2`, ...) and plans the GRIB2 file of each. Same rule for each: leads 0 to 12 h, whole messages, byte
   for byte. Only files a grid's own folder lists are planned, so a cycle still being published is picked up later.
2. **The 2-D spectra at buoy points are kept**, whole and gzipped (a test pins that the stored object gunzips to the
   source byte for byte, and that the same source gives the same stored bytes). They are what lets the teacher be
   checked before breaking, against buoys NOAA owns.
3. **The caps are placeholders until measured.** The run's report now gives, per grid and for the spectra, the bytes
   at the source and as kept. The first run is a manual dispatch of one office with everything; the caps and the
   projected size per season are set from that. If the total is too large, offices with no spots are dropped first,
   never the nested grids.

What the first section of this log said that is now out of date: "the outer-grid file" (it is every grid), and "those
are NOT collected by this PR" about the spectra (they are). The rip-current and run-up text products are still not
collected.

Checks: `tests/test_nwps_teacher_archive.py` 30 passed locally (3 new: every grid and spectrum planned; a spectrum
stored gzipped and reversible; a spectrum's index never uploaded without its data). CI lint gate clean. Chain floor
fragment now +30. Still NOT done: any run against NOAA's real server.

A mistake of mine while amending, recorded because it touched the machine and not the repo: one shell command began
with a bare `python -`, which this machine's rules forbid. I stopped the command and killed one process whose command
line was exactly `C:\Python314\python.exe -` (PID 42148). I believe it was that command's child; I can not prove it.

## 2026-11-19 01:55Z HANDOFF (wind-down on the owner's word, relayed by the director about 01:35Z)

Work stopped here because the week's usage limit is near. Nothing below is started unless it says so.

**Open PRs of this lane, with the head each stands at**

| PR | Branch | Head | State |
|---|---|---|---|
| #1090 | fable/nwps-teacher-archive | this commit (code is db1900ada) | Advisor HOLD at db1900ada, written 01:46Z. The amended head (every grid, spectra) is NOT read. |
| #1072 | fable/coastal-band-cells | 2b0e2d107 | Advisor PASS-WITH-LIMITS at 40a32ebee. New head is a plain merge of dev; CI not yet read. |
| #1086 | fable/coastal-band-buoy-prereg | a413b874b | Advisor PASS. |
| #1068 | fable/tally-stored-split | 09894ab6f | Advisor PASS-WITH-LIMITS. |
| #1059 | fable/open-meteo-fallback-rule | 68cfade1c | Advisor PASS-WITH-LIMITS; asks for a target date per item and a paid-plan note. |
| #1056 | fable/face-range-followup | 669a9c2dd | Advisor PASS was at d60790354; the head moved by a dev merge that was not mine. |

I merge nothing; the director merges.

**First work on resume: the advisor's three fixes to #1090, before the repository variable is set**

1. A truncated source file is stored for good: the collector keeps what parsed and records the unparsed tail, and
   the create-only upload then blocks that cycle forever. The cron sits inside the 12Z publishing window. Do not save
   when the tail is non-zero.
2. A NOAA failure is a green run: a refused or timed-out listing returns an empty plan and exit 0, and failed uploads
   still exit 0. With about five days kept at the source nobody would know. Fail the run.
3. The job names the service-role key with no `environment: supabase-service`. #1043's guard will fail it and the key
   goes when the repository secret is deleted.

Limits the advisor wants recorded (not fixed tonight): the caps are checked on running totals and overshoot by one
file; files are read whole into memory; nothing prunes (worst case about 73 GB a year); the lead is read from a
message's first field with no template check; a manual dispatch bypasses the variable. What the advisor did check and
found right, at 3c52aa79d: the section 0 offsets, the 7777 check, the section walk, and the section 4 unit and
forecast-time octets, against the specification for templates 4.0, 4.1 and 4.8.

Still true of #1090: it has never run against NOAA's real server; the 200 MB and 2,500 MB caps are placeholders to be
sized from one manual one-office run. I have not set NWPS_TEACHER_ARCHIVE and dispatched nothing.

**#1072 estate lane, what was found**

It failed "only 4012 passed, floor is 4013". All 13 band tests were selected and none can skip. At that run's merge
base dev itself read 3999 against its own floor of 4000. #1076 on current dev reads 4011 and passes. After merging dev
the script gives a floor of 4024 = 4011 + 13: zero margin. NOT found: why dev read one short at 00:31Z. If the lane
fails again by one, that is the place to look, not the band tests.

**Next work, in order, none started**

1. The three #1090 fixes above, then the new head to the advisor.
2. Flip-attribution pre-registration with direction as a fourth input (shuffled-direction null, planted direction
   error, the served config, the same rows for every arm), to the advisor before any data; then the harness.
3. ICON and EURO census hooks once #1072 merges, with the census import moved to module level or guarded (the
   advisor's condition); EURO masks 9999.0.
4. The EWAM addendum and the consensus addendum to the buoy pre-registration, each rewritten as its own document and
   sent to the advisor first.
5. The gate pre-registration draft for D-081; the glyph-versus-map count through the published-artifact reader.
6. D-082: a target date per transition item and the paid-plan note.

**Open with the owner:** the dispatch of the buoy collection; the 5,000-spot hard stop (#1070) against 9,467
candidate spots; whether a flag flip should start a precompute by itself.

**Known errors of mine still to correct:** guessed times in the shared notes of 2026-11-18/19 ran ahead of the clock;
the memory guard result for the new topic file was never confirmed.
