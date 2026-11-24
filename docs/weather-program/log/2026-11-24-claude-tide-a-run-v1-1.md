# 2026-11-24 · claude · tide-a-harcon-v1-1: no verdict (an infra error before scoring)

Append-only. Stamps come from `date -u`.

## 22:10Z: run 45497184958, tag `tide-a-harcon-v1-1` on `319d59086`

- **Dispatch:** the director pushed the tag at 22:03:22Z, on David's word ("approved", relayed by the director). The
  instrument and scorer are #1285 at `319d59086`, which had PASS-WITH-LIMITS.
- **What ran:**
  - The download job SUCCEEDED, 22:03:25–22:05:13Z (FES2022b from the cache).
  - In the gate job, step 6 (C1, the vendored `finder_check.py --stations`) FAILED at 22:07:20Z: `urllib.error.HTTPError
    403 Forbidden` from `api.tidesandcurrents.noaa.gov`.
  - Steps 7 (instrument) and 8 (scorer) were SKIPPED.
  - `finder_check` writes its JSON only at the end, so the run has NO artifact.
- **Where:**
  - The finder completed all 25 HARBOR_BAY candidates, then the 20 OPEN_COAST deciding stations and reserves 8418606
    and 9448576.
  - The 403 came on the next station, OPEN_COAST reserve #3, 9452421 (Chilkat Inlet). `finder_check`'s own three
    attempts, with 3 s and 6 s sleeps, did not clear it.
- **Diagnosis (no gate data read):** at about 22:08Z the same query form for 9452421 on a PAST window (2026-11-01..02)
  returned 200 for interval hilo, h and 6, and a control station also returned 200. So it is not a station or product
  problem. The likely cause is CO-OPS throttling a burst of about 140 prediction requests in about 2 minutes. That is
  an inference, not proven.
- **What exists and what does not:**
  - NO outcome was computed: no A_FES or A_HARCON arm, no donor, no C2, C3 or C4, no leg, no verdict.
  - The job log prints C1 control rows (NOAA's own curve through the served finder) for 47 stations. Every printed
    median |h| is ≤ 0.0071 m against the C1 bar of 0.01 m, and the time medians are 0.4–4.1 min. These are control
    data only.
- **Verdict:** NONE. There is no SCOREBOARD row, because no number was produced.
- **Not retried.** Whether this counts as "no run" under the gate's no-re-run rule, and the request-pacing fix, are
  with the advisor (asked by the director). Any new tag needs David's word.
