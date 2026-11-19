# 2026-11-19 — opus: ICON rain collector for the MRMS radar test (research; nothing served)

**Why.** The research lead's ruling on ICON rain sampling (2026-11-19): keep today's 0.125-degree area mean until a radar test
says otherwise. The test scores three arms against NOAA MRMS radar QPE:
- the area mean;
- A' (the nearest native cell);
- a quantile-mapped area mean.

The metrics are FSS at 0.5 / 2 / 5 / 10 mm/h over neighbourhoods of 1 / 3 / 5 cells, frequency bias and mass. The test needs ICON's
NATIVE TOT_PREC for each case:
- DWD's open-data server keeps about a day of runs, and the publisher stores only area-mean frames, so the native field is
  collected FORWARD.
- MRMS is archived publicly (NOAA open data on AWS, `noaa-mrms-pds`), so only ICON is collected.

**Words.**
- Owner, typed in the director's session (~00:50Z), relayed verbatim: "Yes, start the ICON rain collection".
- The director: build it first, US domain, about 20 MB a day, a 30-day auto-stop, idempotent, bytes logged, no Render load. The
  director starts it after merge.

**Built.**
- `backend/scripts/icon_rain_collector.py` and `.github/workflows/icon-rain-collector.yml`.
- Each 00Z run is stored as ONE compressed `.npz` at `research/icon_tot_prec_us/<YYYYMMDDHH>.npz` in the private products bucket.
- The file holds the US cells plus a margin (17-57N, 133-57W; wider than a 5-cell neighbourhood at 0.125 deg), with their centres
  and TOT_PREC at the registered leads f006 / f024 / f048 / f078 / f120 plus the step before each (f005 / f023 / f047 / f077 /
  f117). So every arm de-accumulates on UTC hour ends, as the publisher does and as MRMS hours match.

**Pre-registration (the research lead's three conditions, set before any collection).**
1. **Every day in the window is a case.** No picking rain days.
   - The window is 30 daily runs from the first stored run. The script refuses anything past it, whatever the counts.
   - A day with < 1 % of US cells ≥ 0.5 mm/h on MRMS is scored, marked "dry" and reported separately. FSS pooling uses non-dry
     days.
2. **Every arm's inputs at the same leads,** with the margin for neighbourhood 5.
3. **Private and temporary:** stored in the private products bucket, never in the repo. Delete the prefix after the scored look.
   - The prefix is not a product name (`product_object_gc.is_product_object`, tested), so the product GC never lists it.
   - Before any arm is compared, arm (1) rebuilt from the native files must equal the published frames within encoder rounding.

**Safety.**
- OFF until the repository variable `ICON_RAIN_COLLECT` is `'1'`.
- Idempotent: a stored run is skipped, and each invocation also retries yesterday's 00Z.
- Size-capped at 20 MB an object: over the cap it is refused and logged, never uploaded.
- Bytes go to the step summary.
- No Render call, no manifest write, no served number.
- The key is read by name (`SUPABASE_SERVICE_ROLE_KEY`) in a job on the `supabase-service` environment.

**Size (estimated, not measured on a runner):**
- about 160 k native cells in the box x 10 leads x 4 bytes, plus the cells and centres;
- about 8 MB raw, compressed to about 3-6 MB a run.
The first run's step summary is the measurement.

**Tests:** `backend/tests/test_icon_rain_collector.py`, 10 tests (chain lane, floor fragment +10 / +1 file):
- leads and URLs;
- today and yesterday;
- the window rule;
- the GC never lists the prefix;
- the domain cut in both longitude conventions;
- the packed file;
- idempotence (a second invocation uploads nothing);
- the window and size refusals;
- one run's failure leaves the other;
- the workflow is off until its variable, and passes the key by name only.
