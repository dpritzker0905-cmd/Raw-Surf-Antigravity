# EVIDENCE DIRECTORY — Audit 11.1

Several subdirectories below are **deliberately empty**. An empty evidence folder with no
explanation reads as "nothing was found"; these say what was not captured and why.

| directory | contents | why |
|---|---|---|
| `memory/` | **3 executable probes + 1 output transcript** | The decisive evidence of this audit (T-CAP-01/02/03). Re-runnable. |
| `console/` | `T-TEST-01_frontend_suite.json` | Full jest run: 209/209 suites, 1949/1949 tests. |
| `artifact-manifest.csv` | 10 rows | Every test's ID, timestamp, both commits, runtime, endpoint, location, model, layer, cache state, action sequence and related finding. |
| `videos/` | **empty** | No video was captured because none could support a claim: `document.visibilityState === "hidden"`, **0 rAF ticks in 1.5 s**. A recording of a hidden tab shows the browser's throttle, not the app. See `../OPEN_EVIDENCE_GAPS.md` G-02. |
| `screenshots/` | **empty** | Same reason. A still frame proves less than the live global reads already inlined in the report, and would imply motion evidence that does not exist. |
| `playwright-traces/` | **empty** | The E2E lane was assessed from GitHub Actions run history (by full 40-char SHA), not re-driven locally. |
| `react-scan/`, `react-profiler/` | **empty** | React commit/render behaviour is frame-coupled; not measurable under G-02. |
| `devtools-performance/` | **empty** | Same. |
| `webgl/` | **empty** | The live `__RAW_GPU__` and `__MARINE_CHURN__` reads are inlined in the report (Section 9) rather than dumped here — they are five values, not an artifact. |
| `geographic-tests/` | **empty** | The 13-location projection sweep was not run (G-02). |
| `before-after/` | **empty** | Both controlled A/Bs (science and capacity) are tabulated in `../BEFORE_AFTER_EVIDENCE_MATRIX.md`; the capacity one is reproducible from `memory/`, and the science one from a detached worktree at `c9a0e9fc`. |
| `network/` | **empty** | Response-level facts (`run_census`, `vectors_before_bound`, `bounded_at`, wire size) are captured by the `memory/` probes, which read them from the live responses. No HAR was written — a HAR of an authenticated production session risks capturing credentials. |

**Reproducing the two decisive results**

```bash
# capacity (read-only, 1 request; needs a box whose rss_mb is >=150 MB below its peak_rss_mb)
python audit/weather-simulation-11.1/evidence/memory/T-CAP-03_size_scaling_control.py

# science (no network; controlled A/B against the Report 11.0 baseline)
git worktree add --detach /tmp/wt-11.0 c9a0e9fc
cd /tmp/wt-11.0/backend && python -c "import sys;sys.path.insert(0,'.');from services.weather_pipeline import sim_rating as s;spot={'name':'Pipeline','latitude':21.665,'longitude':-158.053};print([(h,s.calculate_surf_rating(spot,h,14.0,315.0,5.0,270.0)['breaking_height_ft'],s.calculate_surf_rating(spot,h,14.0,315.0,5.0,270.0)['quality_rating']) for h in (0.5,1.0,4.0,8.0,12.0)])"
```
