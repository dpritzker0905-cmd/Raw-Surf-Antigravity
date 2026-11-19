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
