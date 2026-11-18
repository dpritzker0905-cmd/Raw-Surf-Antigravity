# 2026-11-18 — opus: ICON air temperature draws our own 0.125-degree DWD frames (ON, kill switch), off Open-Meteo

## Why
- #998's verification (log `2026-11-17-opus-raster-ship-on.md`): all five new sets publish at 100 %, but the client reads none
  of them by default, so ICON air temperature still draws Open-Meteo's `.om` copy (`openMeteoEndpoints.js`).
- Owner, 2026-11-18: "No user data should be open-meteo". Owner, 19:09Z: Open-Meteo is allowed as a FALLBACK only when nothing
  better exists.
- The director assigned this client change (2026-11-18). Scope: flip each layer and model to our own set where one is published
  and passes parity, ON with a kill switch, `.om` kept as the fallback; start with ICON temperature.
- Exit plan: `open-meteo-exit-plan-2026-11-18.md`, rows B2 / E2.

## Gate (pre-registered by the director's scope, read here against existing evidence)
The temperature row of the exit plan's table C:
- bias ≤ 0.3 K against the native field;
- every frame hour equals its label.

Evidence, none of it new in this PR:
1. **Parity with what users see today, `.om` `dwd_icon` `temperature_2m`.**
   - Source: log `2026-11-16-opus-icon-precip-0p125-cloud-temp.md`, "06:24Z: G1 option (a) result", instrument `g1a_gate.py`,
     run 2026-11-16 00Z, all 2879 x 1441 shared nodes, our encoded-then-decoded frame.
   - Exactly equal on 97.7 % / 97.8 % / 97.5 % of nodes at f006 / f048 / f120.
   - Median and p99 |difference| are 0.00 degC at every hour. The max is 6-7 degC on the ~2.3 % of nodes where the two pick a
     different nearest cell.
   - Positive control (`.om` of another hour): 1.5 % equal, median 1.15 degC. It fails, as it must.
   - The bias is therefore ≤ 0.3 K by these readings, though no mean signed error was computed.
2. **Frame hour equals its label.** Every frame's `valid_time` is the index entry's, or the client refuses the frame
   (`loadOwnOnly`, |Δ| ≤ 1 s; pinned by the new test). The live index today, 2026-11-18 12Z run, read 20:3xZ:
   - 61 frames, f000 → 2026-11-18T12Z and f180 → 2026-11-26T00Z;
   - each from DWD's `icon_global_icosahedral_single-level_2026111812_<fff>_T_2M.grib2.bz2`.
3. **Resolution.** 2880 x 1441 at 0.125 deg, as fine as the `.om` `dwd_icon` grid, so the no-regression rule holds.

## The change (frontend only)
- `ownRasterFrames.js`:
  - ICON temperature key `ICON/weather/temperature/global_0p125`;
  - `DEFAULT_ON_MODELS = { temperature: ['ICON'] }`;
  - the temperature set decodes off the main thread (`workerDecode`, the own-only layers' worker);
  - a handheld node budget of four 0.125-degree frames (~66 MB of Float32). The ±1 window fits, and 0.25-degree sets never reach
    the budget.
- `staticRasterSets.js`: the 0.125 key is listed.
- **Kill:** `window.__RAW_DISABLE_RASTER_OWN_TEMPERATURE__ = true`. The global own-frames kill and the per-set kill also work.
  Each returns ICON temperature to the `.om` path, as before. GFS and EURO temperature are unchanged (OFF).
- Frame size, measured: 2.65 MB gzipped (8.30 MB raw) per frame, against 1.1-5 MB per hour on the `.om` path
  (`2026-10-22-claude-raster-instant.md`).

## Not done here (next, per the director's scope)
- **Rain ICON (`precipitation_icon_0p125`):** published, gated in G2. It needs a client key and an ICON `rain` entry.
- **Cloud EURO (`cloud_cover_euro`) and ICON:** published (EURO); ICON's 0.125 set was reverted (#1014).
- **Fog all models:** decided as DEFAULT-OFF pending the owner (vote split 2026-11-14).
- **Water temp EURO and ICON:** water temp EURO and air temperature EURO were also left OFF pending the owner in that vote.
  The owner's 2026-11-18 rule may settle them; that is the director's call.
- **GFS temperature (0.5 deg) and GFS water temp (0.25 deg):** coarser than the `.om` gfs013. A 0.125-degree GFS set is needed
  first.
- **ICON-EU sets:** after these.
- **Post-deploy live check (D-080):** after merge, open the dev map with ICON + air temperature and confirm in the network panel
  that it reads the CDN frames and makes no `openmeteo.s3` request for temperature.

## Product GC sweeps read (PRODUCT_RUN_KEYED_NAMES, #1005 / #1020), core `forecast-ingest.yml`
Instrument: `gh run view <id> --log`, the `[Product GC]` line. Each sweep was checked for FUSE and `path not found` lines and
had none.

| run | event | sweep at | listed | referenced | marked | deleted | left | bulk batches |
|---|---|---|---|---|---|---|---|---|
| 44351331807 | workflow_dispatch | 18:09:12Z | 36,830 | 18,385 | 18,433 | 0 | 0 | 0 |
| 44356945782 | schedule | 20:01:27Z | 38,940 | 18,389 | 4,062 | 16,477 | 0 | 17 |

- `referenced` holds at ~18,385-18,389. That is within 0.1 % of the 11-17 sweeps, far from FUSE A's 0.8 ratio.
- The 18:09Z sweep deleted nothing: it marked this cycle's superseded objects inside the 2 h grace.
- The 20:01Z sweep deleted 16,477 of the 38,940 listed (42 %), under FUSE B's 60 % and the 25,000 cap.
