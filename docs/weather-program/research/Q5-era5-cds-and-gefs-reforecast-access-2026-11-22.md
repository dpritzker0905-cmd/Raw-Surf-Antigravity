# Q5 — ERA5 access for the wind v2 climatology: CDS API path and GEFSv12 reforecast fallback (2026-11-22)

Scope: check access only. **No data collected. No CDS request dispatched.** Read-only.

**Plan status (amendment-2):** the wind plan now uses the **CMEMS L4 wind** as its primary source. **ERA5 is the fallback only.** Everything below is about the fallback path.

## 1. The CDS API path (cdsapi, checked with context7 `/ecmwf/cdsapi`)

Credential lookup, in the order the client resolves it:
- `url` / `key` arguments, then environment variables `CDSAPI_URL` and `CDSAPI_KEY`, then `~/.cdsapirc` (path overridable by `CDSAPI_RC`).
- `~/.cdsapirc` takes `url:` and `key:` lines. `key` is `<UID>:<APIKEY>` for the current client (a bare token is the legacy form).
- The client asserts the key splits into exactly two parts on `:`.

**Name correction (amendment-1 used the wrong name):** the client reads **`CDSAPI_KEY`**, not `CDS_API_KEY`. The `CDS_API_KEY` name in the
brief would not be picked up. Report the name by its real value: `CDSAPI_KEY` (env) or the `key:` line in `~/.cdsapirc`.
Never write the value into a file or message.

The repo's existing ERA5 lane is `backend/scripts/era5_deepen_climatology.py`. It builds `cdsapi.Client(quiet=True)` and uses two
datasets: `reanalysis-era5-single-levels-timeseries` (a spot's full hourly history) and the gridded `reanalysis-era5-single-levels`
(which carries `peak_wave_period`). Its header says it "Requires ~/.cdsapirc". `cdsapi` is pinned in `backend/requirements-dev.txt`,
not `requirements.txt`. Prior handoffs (2026-08-03) record the token as present on the working machine since 2026-07-30.

**Measured here:**
- `~/.cdsapirc`: **absent** in this session's environment.
- `CDSAPI_KEY`: **not set** here.
- `cdsapi` import: **not installed** in this session's Python.
- So the live auth check was **not performed**. It would need the key on this machine, which it is not. A live call (even
  a tiny request) is also a collection step, which the brief forbids without David's word.

**Known constraint for the v2 climatology (from the script's own comments, measured 2026-08-03):** ERA5's wave grid is about
0.5°, and a surf spot sits on the coast, so the nearest wave cell is often land or the wrong water. The script already
guards this. The v2 design must carry the same guard. CDS queueing also makes each request take minutes of waiting, not CPU.

## 2. GEFSv12 reforecast as a fallback

- Source: NOAA PSL reforecast page (search, 2026-11-22) and the AWS Open Data registry. The GEFSv12 reforecast 2000–2019
  is on AWS S3 bucket **`noaa-gefs-retrospective`** (us-east-1), free under NOAA's Big Data Program, GRIB2.
- The AWS listing says the bucket can be listed **unsigned** with the AWS CLI, with no AWS account. Verify before relying on it.
- A UCAR record describes a 31-year ensemble reforecast (1989–2019). The AWS portion we reached is 2000–2019. The 1989–1999
  phase is listed separately and was not confirmed on AWS here.
- Caveat: PSL's "discontinued" notice applies to the older GEFS Reforecast **Version 2** page, not to GEFSv12.
- Not fetched. No bucket listing or download was run.

**Trade-off to weigh before choosing:** GEFSv12 is a global ensemble reforecast with a 0.25° grid and 6-hourly steps, so it has
the same coastal-cell problem as ERA5 unless we interpolate to the spot. It is an independent source, so it is a useful
cross-check against ERA5 rather than a replacement.

## 3. What is needed to run it (no dispatch yet)

| Need | Name / location | Status here |
|---|---|---|
| CDS credential | `CDSAPI_KEY` env, or `key:` in `~/.cdsapirc` (`url:` alongside) | absent on this machine |
| Client | `pip install cdsapi` (dev requirements) | not installed here |
| GEFSv12 access | none (unsigned S3 read of `noaa-gefs-retrospective`) | not tested |
| Compute | CDS queue, one request per spot-period | not dispatched |

## 4. Recommendation

1. The credential is the blocker for a live check, and it lives on the working machine, not here. Run the auth check there
   (client construct only, plus one zero-cost metadata call if the lane offers one), never a retrieve, before any dispatch.
2. Use ERA5 timeseries for the spot climatology as the existing lane does, keep the coastal-cell guard, and decide the
   GEFSv12 cross-check only after David says go.
3. Do not dispatch a collection until David says so. The brief is explicit.

## 5. Open items

- Confirm the unsigned GEFSv12 listing on `noaa-gefs-retrospective` in a read-only `ls` with no download.
- Confirm the 1989–1999 phase is reachable, if the v2 window needs it.
- Confirm on the working machine that `CDSAPI_KEY` or `~/.cdsapirc` exists, by name only.

Sources: ecmwf/cdsapi docs (context7, `_autodocs/configuration.md` and `api-reference/client.md`); repo
`backend/scripts/era5_deepen_climatology.py`, `backend/requirements-dev.txt`; `docs/runbooks/HANDOFF-2026-08-03-D-*.md`;
NOAA PSL GEFS Reforecast Version 2 page and the AWS Open Data registry entry for `noaa-gefs-retrospective`.
