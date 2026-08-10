"""Forecast skill ledger (2026-07-30): per-lead accuracy vs reality and vs a competitor.

Pins the ledger's honesty properties: the earliest forecast per (source, buoy, target, lead)
wins, scoring joins only within tolerance of real observations, unmatched rows expire instead of
lingering, and the summary reports independence (n_buoys) beside n."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from services.weather_pipeline.forecast_skill import (
    SOURCE_OM, SOURCE_OURS,
    fetch_om_forecast_rows, merge_pending, rows_from_calibration_report,
    score_pending, skill_summary,
)

NOW = datetime(2026, 7, 30, 18, 0, tzinfo=timezone.utc)


def _report(entries):
    return {"spots": entries}


def _entry(bid, model_hs=1.5, model_tp=10.0, buoy_time=None, buoy_wvht=None):
    res = {"model_hs_m": model_hs, "model_tp_s": model_tp}
    if buoy_wvht is not None:
        res["buoy_wvht_m"] = buoy_wvht
        res["buoy_dpd_s"] = 9.0
    e = {"buoy_id": bid, "residual": res}
    if buoy_time:
        e["buoy_time"] = buoy_time
    return e


def test_rows_from_report_one_per_buoy_and_no_coverage_holes():
    rep = _report([
        _entry("46012", model_hs=2.0),
        _entry("46012", model_hs=2.2),          # duplicate buoy (two spots share it) -> one row
        _entry("41009", model_hs=0.0),          # a 0.0 model value is a coverage hole, not skill
        _entry("51201", model_hs=1.1),
    ])
    rows = rows_from_calibration_report(rep, "2026-07-31T18:00:00Z", 24)
    assert [(r["buoy_id"], r["hs_m"]) for r in rows] == [("46012", 2.0), ("51201", 1.1)]
    assert all(r["source"] == SOURCE_OURS and r["lead_h"] == 24 for r in rows)


def test_merge_pending_earliest_forecast_wins_and_expires():
    early = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-31T18:00:00Z", "lead_h": 72.0, "hs_m": 1.0}
    later = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-31T18:00:00Z", "lead_h": 68.0, "hs_m": 1.4}
    stale = {"source": SOURCE_OURS, "buoy_id": "46012",
             "target_time": "2026-07-20T00:00:00Z", "lead_h": 24.0, "hs_m": 2.0}
    merged = merge_pending([early, stale], [later], now=NOW)
    assert merged == [early]                     # first (earliest) wins; the stale target expired


def test_score_pending_joins_within_tolerance_and_expires_the_rest():
    pending = [
        {"source": SOURCE_OURS, "buoy_id": "46012",
         "target_time": "2026-07-30T17:00:00Z", "lead_h": 24.0, "hs_m": 1.8},
        {"source": SOURCE_OM, "buoy_id": "46012",
         "target_time": "2026-07-30T17:00:00Z", "lead_h": 24.0, "hs_m": 2.4},
        {"source": SOURCE_OURS, "buoy_id": "46012",
         "target_time": "2026-08-01T18:00:00Z", "lead_h": 48.0, "hs_m": 1.2},  # future -> stays
        {"source": SOURCE_OURS, "buoy_id": "41009",
         "target_time": "2026-07-25T00:00:00Z", "lead_h": 24.0, "hs_m": 1.0},  # old, no obs -> drops
    ]
    rep = _report([_entry("46012", buoy_time="2026-07-30T17:40:00Z", buoy_wvht=2.0)])
    still, scored = score_pending(pending, rep, now=NOW)
    assert [r["target_time"] for r in still] == ["2026-08-01T18:00:00Z"]
    assert len(scored) == 2
    ours = next(r for r in scored if r["source"] == SOURCE_OURS)
    assert ours["obs_hs_m"] == 2.0 and ours["err_m"] == -0.2


def test_skill_summary_reports_independence():
    scored = [
        {"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.2},
        {"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 26.0, "err_m": -0.2},
        {"source": SOURCE_OURS, "buoy_id": "b", "lead_h": 24.0, "err_m": 0.4},
        {"source": SOURCE_OM, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.6},
    ]
    table = skill_summary(scored)
    ours = next(r for r in table if r["source"] == SOURCE_OURS)
    om = next(r for r in table if r["source"] == SOURCE_OM)
    assert ours["n"] == 3 and ours["n_buoys"] == 2
    assert ours["mae_m"] == round((0.2 + 0.2 + 0.4) / 3, 4)
    assert om["mae_m"] == 0.6


def test_fetch_om_forecast_rows_batches_and_slices_leads():
    times = [(NOW + timedelta(hours=k)).strftime("%Y-%m-%dT%H:00") for k in range(0, 96)]
    loc = {"hourly": {"time": times,
                      "wave_height": [1.0 + 0.01 * k for k in range(96)],
                      "swell_wave_period": [8.0] * 96}}
    payload = [loc, loc]

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps(payload).encode()

    with patch("services.weather_pipeline.forecast_skill.urllib.request.urlopen",
               return_value=_Resp()), \
         patch("services.weather_pipeline.forecast_skill.json.load",
               side_effect=lambda f: payload):
        rows = fetch_om_forecast_rows({"46012": (37.5, -122.5), "41009": (28.5, -80.2)}, NOW)
    assert len(rows) == 6                        # 2 buoys x 3 leads
    assert {r["lead_h"] for r in rows} == {24.0, 48.0, 72.0}
    r24 = next(r for r in rows if r["buoy_id"] == "46012" and r["lead_h"] == 24.0)
    assert r24["hs_m"] == 1.24 and r24["source"] == SOURCE_OM
    assert r24["target_time"].endswith(":00Z")


# ══ VERIFICATION METRICS (MASTER AUDIT 1.0 §8.1) ═══════════════════════════════════════════════
#
# The ledger reported BIAS and MAE and nothing else, and the archive's first reading gave ours MAE
# 0.304 vs Open-Meteo 0.199 at ~ZERO BIAS ON BOTH SIDES. That is a SCATTER gap — and the two
# reported numbers are exactly the pair that cannot see one. These tests pin the arithmetic against
# hand-computed values, and the first one is the whole argument in a single assertion.

from services.weather_pipeline.forecast_skill import (  # noqa: E402
    MIN_N_FOR_SHAPE, obs_band, verification_metrics,
)


def test_scatter_and_offset_are_INDISTINGUISHABLE_by_mae_and_rmse_but_not_by_si():
    """⭐ THE POINT OF THIS WHOLE CHANGE.

    Two forecasts, twelve points each, observed 1.0 m throughout:
      A  alternates +0.5 / -0.5   -> pure SCATTER, zero bias
      B  is always  +0.5          -> pure OFFSET,  zero scatter
    Both have MAE 0.5 and RMSE 0.5 — the old summary graded them identically. The de-biased
    scatter index separates them completely (0.5 vs 0.0), which is the difference between "a
    constant can fix this" and "no constant can".
    """
    obs = [1.0] * 12
    a = verification_metrics([(1.0 + (0.5 if i % 2 == 0 else -0.5), o) for i, o in enumerate(obs)])
    b = verification_metrics([(o + 0.5, o) for o in obs])

    assert a["mae_m"] == b["mae_m"] == 0.5
    assert a["rmse_m"] == b["rmse_m"] == 0.5          # identical under the OLD instrument
    assert a["bias_m"] == 0.0 and b["bias_m"] == 0.5
    assert a["si"] == 0.5 and b["si"] == 0.0          # and completely separated by the new one
    assert b["sym_slope"] == 1.5                      # B over-reads amplitude by 50%


def test_a_perfect_forecast_is_the_known_good_control():
    """An instrument that cannot come back 'this is fine' is not evidence."""
    obs = [0.4 + 0.2 * i for i in range(12)]
    m = verification_metrics([(o, o) for o in obs])
    assert m["bias_m"] == 0.0 and m["mae_m"] == 0.0 and m["rmse_m"] == 0.0
    assert m["si"] == 0.0 and m["corr"] == 1.0 and m["sym_slope"] == 1.0


def test_shape_metrics_REFUSE_below_min_n_rather_than_report_an_unstable_number():
    """A correlation from n=2 is always +/-1. Reporting it would read as excellence."""
    obs = [0.5 * (i + 1) for i in range(MIN_N_FOR_SHAPE - 1)]
    m = verification_metrics([(o, o) for o in obs])
    assert m["n_paired"] == MIN_N_FOR_SHAPE - 1
    assert m["mae_m"] == 0.0 and m["rmse_m"] == 0.0          # these are stable at any n
    assert m["si"] is None and m["corr"] is None and m["sym_slope"] is None


def test_correlation_refuses_on_zero_variance_instead_of_reporting_zero():
    """A flat sea gives a zero denominator. `0.0` would read as 'the forecast tracks nothing'."""
    m = verification_metrics([(1.0, 1.0)] * 12)
    assert m["corr"] is None, "reported a correlation with no variance to correlate"
    assert m["si"] == 0.0 and m["sym_slope"] == 1.0


def test_si_refuses_when_there_is_no_sea_to_normalise_by():
    """SI divides by mean observed. At mean 0 the honest answer is None, not 0.0 (= perfect)."""
    m = verification_metrics([(0.1, 0.0)] * 12)
    assert m["si"] is None, "divided by an empty sea and called the result perfect"
    assert m["sym_slope"] is None                            # sum(obs^2) == 0 too
    assert m["mae_m"] == 0.1                                 # the plain metrics still work


def test_empty_and_unpaired_input_yield_None_not_a_zero_row():
    assert verification_metrics([]) is None
    assert verification_metrics([(None, 1.0), (1.0, None)]) is None


def test_summary_adds_metrics_without_changing_the_existing_series():
    """⚠️ The archive is one continuous series. Rows that carry only `err_m` — every row written
    before this change — must keep their exact n/bias/mae and gain NO fabricated shape metrics."""
    legacy = [{"source": SOURCE_OURS, "buoy_id": "a", "lead_h": 24.0, "err_m": 0.2},
              {"source": SOURCE_OURS, "buoy_id": "b", "lead_h": 24.0, "err_m": 0.4}]
    row = skill_summary(legacy)[0]
    assert row["n"] == 2 and row["mae_m"] == 0.3
    assert "si" not in row and "by_obs_band" not in row, "invented metrics from unpaired rows"

    paired = [{"source": SOURCE_OURS, "buoy_id": f"b{i}", "lead_h": 24.0,
               "hs_m": 1.0 + 0.5, "obs_hs_m": 1.0, "err_m": 0.5} for i in range(12)]
    prow = skill_summary(paired)[0]
    assert prow["n"] == 12 and prow["n_paired"] == 12
    assert prow["si"] == 0.0 and prow["bias_m"] == 0.5       # pure offset, correctly separated


def test_obs_band_stratification_splits_flat_water_from_rideable_surf():
    """A single MAE hides the shape: measured at 60 buoys GFS's error was concentrated on FLAT
    seas (0.616 vs EURO's 0.263). Over-reading a calm day is the app inventing surf."""
    flat = [{"source": SOURCE_OURS, "buoy_id": f"f{i}", "lead_h": 24.0,
             "hs_m": 1.1, "obs_hs_m": 0.2, "err_m": 0.9} for i in range(12)]
    rideable = [{"source": SOURCE_OURS, "buoy_id": f"r{i}", "lead_h": 24.0,
                 "hs_m": 2.1, "obs_hs_m": 2.0, "err_m": 0.1} for i in range(12)]
    row = skill_summary(flat + rideable)[0]
    bands = row["by_obs_band"]
    assert bands["flat <0.5m"]["mae_m"] == 0.9
    assert bands["rideable 1.5-3m"]["mae_m"] == 0.1
    assert row["mae_m"] == 0.5, "the pooled average hides both"
    assert obs_band(0.2) == "flat <0.5m" and obs_band(2.0) == "rideable 1.5-3m"
    assert obs_band(None) is None


def test_the_band_table_is_not_a_second_copy():
    """`scripts/model_skill_census.py` must IMPORT the bands, not redefine them — a duplicated
    constant diverges only on a boundary, and this repo has already paid for seven copies of one."""
    import importlib.util
    from pathlib import Path
    from services.weather_pipeline.forecast_skill import OBS_BANDS
    spec = importlib.util.spec_from_file_location(
        "_census", Path(__file__).resolve().parents[1] / "scripts" / "model_skill_census.py")
    census = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(census)
    assert census.BANDS is OBS_BANDS, "the census redefined the bands instead of importing them"


# ─── THE CAP MUST NOT EAT THE LEDGER (2026-08-08, MASTER-AUDIT-11.0 §3.1) ────────────────────────
# From 08-04T12:36Z to 08-08 every production run logged scored=0 on all three leads: the 08-03
# model fan-out pushed steady-state demand (~17,280 rows) past the old 10,000 cap, and the cap kept
# the LATEST targets — evicting each row exactly as its target hour approached. This suite was
# green the whole time because dedupe and expiry were pinned and eviction order was not. These are
# the missing pins. The simulation uses the REAL merge/score functions at the production shape:
# lanes derived from the module's own fan-out config, 60 buoys, 12 runs/day, perfect buoy truth —
# so the ONLY loss mechanism is eviction.

def _simulate_cadence(cap, runs=60, warmup=42, buoys=60):
    from services.weather_pipeline.forecast_skill import (
        LEADS_H, _lead_bucket, compare_models, source_for)
    bids = ["4%04d" % i for i in range(buoys)]
    lanes = [source_for(m, "GFS") for m in ["GFS"] + compare_models("GFS")] + [SOURCE_OM]
    t0 = datetime(2026, 8, 1, 0, 15, tzinfo=timezone.utc)
    pending, ledgered, scored = [], {1: 0, 2: 0, 3: 0}, {1: 0, 2: 0, 3: 0}
    for i in range(runs):
        now = t0 + timedelta(hours=i * 2)                      # 12 runs/day
        inc = [{"source": lane, "buoy_id": b, "lead_h": float(lead), "hs_m": 1.5,
                "target_time": (now + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00:00Z")}
               for lane in lanes for lead in LEADS_H for b in bids]
        if i >= warmup:
            for r in inc:
                ledgered[_lead_bucket(r["lead_h"])] += 1
        pending = merge_pending(pending, inc, now=now, max_entries=cap)
        truth = _report([{"buoy_id": b, "buoy_time": now.isoformat(),
                          "residual": {"buoy_wvht_m": 1.4, "buoy_dpd_s": 11.0}} for b in bids])
        pending, just = score_pending(pending, truth, now=now)
        if i >= warmup:
            for r in just:
                scored[_lead_bucket(r["lead_h"])] += 1
    # steady state ⇒ flux balance: scored-in-window / ledgered-in-window ≈ survival rate
    return {b: 100.0 * scored[b] / (ledgered[b] or 1) for b in (1, 2, 3)}


def test_every_lead_scores_through_the_shipped_cap_at_production_fanout(monkeypatch):
    """The regression that was live for four days: at production cadence and fan-out, all three
    lead buckets must score ~everything. Fails if the cap drops under steady-state demand OR if
    eviction order regresses to keep-latest (which zeroes all three)."""
    monkeypatch.delenv("FORECAST_SKILL_COMPARE_MODELS", raising=False)
    from services.weather_pipeline.forecast_skill import PENDING_MAX_ENTRIES
    rates = _simulate_cadence(cap=PENDING_MAX_ENTRIES)
    assert all(rates[b] >= 99.0 for b in (1, 2, 3)), (
        f"a lead bucket starved under the shipped cap: {rates} — either PENDING_MAX_ENTRIES "
        f"dropped under steady-state demand or merge_pending's eviction order regressed")


def test_an_undersized_cap_starves_the_farthest_lead_first_not_everything(monkeypatch):
    """The graceful-degradation property that makes overflow a degradation instead of an outage:
    with the cap forced UNDER demand (the exact 08-04 condition), the near leads keep scoring and
    only the farthest starves. The old keep-latest order scores 0/0/0 here."""
    monkeypatch.delenv("FORECAST_SKILL_COMPARE_MODELS", raising=False)
    rates = _simulate_cadence(cap=10000)     # the old cap, < the ~17,280 steady-state demand
    assert rates[1] >= 99.0, f"+24h must survive an overflowing cap, got {rates}"
    assert rates[2] >= 60.0, f"+48h must mostly survive an overflowing cap, got {rates}"
    assert rates[3] >= 1.0, f"+72h may starve under overflow but never to zero, got {rates}"


def test_the_cap_holds_headroom_over_the_documented_production_demand(monkeypatch):
    """The 08-03 fan-out tripled demand and nothing checked the cap — this does. Demand follows
    the module's own fan-out config, so adding a compare model without re-sizing fails HERE
    instead of as scored=0 in production four days later."""
    monkeypatch.delenv("FORECAST_SKILL_COMPARE_MODELS", raising=False)
    from services.weather_pipeline.forecast_skill import (
        LEADS_H, PENDING_MAX_ENTRIES, compare_models)
    lanes = 1 + len(compare_models("GFS")) + 1 + 1    # ours + compares + Open-Meteo + persistence
    buoys, runs_per_day = 60, 12                      # NDBC map size; forecast-ingest 6 + precompute 6
    demand = buoys * lanes * runs_per_day * sum(h // 24 for h in LEADS_H)
    assert PENDING_MAX_ENTRIES >= demand * 1.3, (
        f"PENDING_MAX_ENTRIES={PENDING_MAX_ENTRIES} has <30% headroom over steady-state demand "
        f"{demand} ({lanes} lanes x {buoys} buoys x {runs_per_day} runs/day x 6 lead-days). "
        f"Re-size it WITH the fan-out change, not four days after.")


def test_merge_stats_distinguish_expiry_from_cap_eviction():
    """The instrument: cap starvation was invisible for four days because nothing counted it."""
    rows = [{"source": SOURCE_OURS, "buoy_id": str(i),
             "target_time": (NOW + timedelta(hours=6 + i)).strftime("%Y-%m-%dT%H:00:00Z"),
             "lead_h": 24.0, "hs_m": 1.0} for i in range(3)]
    stale = {"source": SOURCE_OURS, "buoy_id": "s", "lead_h": 24.0, "hs_m": 1.0,
             "target_time": (NOW - timedelta(hours=200)).strftime("%Y-%m-%dT%H:00:00Z")}
    stats = {}
    kept = merge_pending([stale] + rows, [], now=NOW, max_entries=2, stats=stats)
    assert stats == {"kept": 2, "expired": 1, "cap_evicted": 1}
    assert [r["buoy_id"] for r in kept] == ["0", "1"], (
        "the cap must evict the FURTHEST-FUTURE target, not the nearest-to-scoreable")


def test_attach_to_report_distinguishes_ran_and_scored_zero_from_did_not_run():
    """With the old `if skill.get('summary')` caller guard, scored=0 was byte-identical on the
    wire to 'the ledger never ran' — which is why the 08-04 outage was only datable from CI logs."""
    from services.weather_pipeline.forecast_skill import attach_to_report
    ran_but_zero = {"ledgered": 720, "scored": 0, "pending_kept": 17280,
                    "pending_evicted_cap": 0, "summary": []}
    report = {}
    attach_to_report(report, ran_but_zero)
    assert report["forecast_skill"] == []            # present-but-empty: ran, scored nothing
    assert report["forecast_skill_ops"] == {"ledgered": 720, "scored": 0,
                                            "pending_kept": 17280, "pending_evicted_cap": 0}
    silent = {}
    attach_to_report(silent, None)                   # disabled/crashed: keys absent
    assert "forecast_skill" not in silent and "forecast_skill_ops" not in silent


# ─── THE PERSISTENCE BASELINE (2026-08-09, MASTER-AUDIT-11.0 Phase 0) ────────────────────────────
# Without it the ledger's only reference is a competitor — which says who is better, never whether
# either beats "tomorrow = today". These pins mirror the fan-out family above: the rows must be
# real, deduped, honest about dark buoys, and must ride the existing scoring path unchanged.

def test_persistence_rows_are_one_per_buoy_lead_and_refuse_dark_buoys():
    from services.weather_pipeline.forecast_skill import (
        SOURCE_PERSISTENCE, persistence_rows_from_report)
    rep = _report([
        _entry("46012", buoy_time=NOW.isoformat(), buoy_wvht=1.4),
        _entry("46012", buoy_time=NOW.isoformat(), buoy_wvht=1.5),   # shared buoy -> one set
        _entry("41009"),                                             # dark buoy -> no fabrication
        _entry("51201", buoy_time=NOW.isoformat(), buoy_wvht=0.8),
    ])
    rows = persistence_rows_from_report(rep, NOW)
    assert len(rows) == 2 * 3, f"expected 2 live buoys x 3 leads, got {len(rows)}"
    assert {r["buoy_id"] for r in rows} == {"46012", "51201"}
    assert all(r["source"] == SOURCE_PERSISTENCE for r in rows)
    by_buoy = {r["buoy_id"]: r["hs_m"] for r in rows}
    assert by_buoy == {"46012": 1.4, "51201": 0.8}, (
        "the persistence forecast must be the buoy's CURRENT observation, first entry per buoy")


def test_a_persistence_row_scores_through_the_existing_path_unchanged():
    """The whole design is zero new mechanism: the row must survive merge_pending and score
    against a later observation exactly like a model row."""
    from services.weather_pipeline.forecast_skill import persistence_rows_from_report
    rep_now = _report([_entry("46012", buoy_time=NOW.isoformat(), buoy_wvht=1.4)])
    rows = persistence_rows_from_report(rep_now, NOW)
    later = NOW + timedelta(hours=24)
    rep_later = _report([_entry("46012", buoy_time=later.isoformat(), buoy_wvht=2.0)])
    pending = merge_pending([], rows, now=NOW)
    still, scored = score_pending(pending, rep_later, now=later)
    lead24 = [r for r in scored if r["lead_h"] == 24.0]
    assert len(lead24) == 1
    assert abs(lead24[0]["err_m"] - (1.4 - 2.0)) < 1e-9, (
        "persistence err must be current-obs minus future-obs")
    summary = skill_summary(scored)
    assert any(s["source"] == "persistence" for s in summary), (
        "persistence must appear as its own source row in the summary")


def test_the_persistence_kill_switch_and_the_demand_it_adds(monkeypatch):
    """The 08-03 lesson enforced on ourselves: adding this lane grew steady-state demand by
    4,320 rows (60 buoys x 12 runs x 6 lead-days), so the headroom test's lane count was
    incremented IN THE SAME COMMIT. This pins the kill switch that prices it back out."""
    from services.weather_pipeline.forecast_skill import persistence_rows_from_report
    rep = _report([_entry("46012", buoy_time=NOW.isoformat(), buoy_wvht=1.4)])
    assert len(persistence_rows_from_report(rep, NOW)) == 3
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    # the switch is honoured at the run_skill_ledger call site; the builder itself stays pure
    import services.weather_pipeline.forecast_skill as FS
    import inspect
    src = inspect.getsource(FS.run_skill_ledger)
    assert 'FORECAST_SKILL_PERSISTENCE' in src, (
        "the kill switch left run_skill_ledger -- the lane can no longer be priced out")
    assert 'persistence_rows_from_report(report' in src, (
        "run_skill_ledger no longer builds persistence rows -- the baseline shipped and reaches "
        "nobody, the repo's own recorded defect class")


# ── PAIRED head-to-head (2026-08-10): the guard on the false alarm that made it exist ──────────
from services.weather_pipeline.forecast_skill import head_to_head  # noqa: E402


def _scored(source, buoy, target, lead_h, err_m):
    return {"source": source, "buoy_id": buoy, "target_time": target,
            "lead_h": lead_h, "err_m": err_m}


def test_head_to_head_INVERTS_the_verdict_an_unpaired_column_gives():
    """THE REGRESSION THIS EXISTS FOR, reproduced in miniature.

    On 2026-08-10 the per-source column read `raw_surf` 0.268 vs `persistence` 0.206 and that was
    reported as "we lose to the trivial baseline". It was an artifact of unequal populations:
    persistence only scores buoys with a live observation, so it covered 7 target times to our 64.
    Paired on identical keys we WIN. This fixture reproduces the inversion exactly: ours is worse
    on the UNPAIRED average and better on every SHARED key.
    """
    rows = []
    # Shared keys: ours is strictly better on each one.
    for i in range(6):
        t = "2026-08-10T%02d:00:00Z" % i
        rows.append(_scored("raw_surf", "B1", t, 24, 0.10))
        rows.append(_scored("persistence", "B1", t, 24, 0.30))
    # Ours ALSO covers hard targets the baseline never scored -- this is the whole distortion.
    for i in range(6, 20):
        rows.append(_scored("raw_surf", "B1", "2026-08-10T%02d:00:00Z" % i, 24, 0.90))

    unpaired = {s["source"]: s["mae_m"] for s in skill_summary(rows)}
    assert unpaired["raw_surf"] > unpaired["persistence"], (
        "SETUP BROKEN: the unpaired column must say we lose, or this proves nothing")

    h = [c for c in head_to_head(rows) if c["source"] == "persistence"][0]
    assert h["n_paired"] == 6
    assert h["we_lose"] is False, "paired comparison must invert the unpaired verdict"
    assert h["mae_ours_m"] == 0.10 and h["mae_theirs_m"] == 0.30
    assert h["win_rate"] == 1.0
    assert h["n_ours_total"] == 20 and h["n_theirs_total"] == 6, (
        "the unpaired totals must be published beside n_paired -- their divergence is the tell")


def test_head_to_head_confirms_a_REAL_loss_when_the_populations_match():
    """Known-present control. A guard that only ever flips 'lose' to 'win' would hide a real gap."""
    rows = []
    for i in range(10):
        t = "2026-08-10T%02d:00:00Z" % i
        rows.append(_scored("raw_surf", "B1", t, 24, 0.40))
        rows.append(_scored("open_meteo_marine", "B1", t, 24, 0.20))
    h = [c for c in head_to_head(rows) if c["source"] == "open_meteo_marine"][0]
    assert h["n_paired"] == 10 == h["n_ours_total"] == h["n_theirs_total"]
    assert h["we_lose"] is True and h["delta_m"] == 0.20 and h["win_rate"] == 0.0


def test_head_to_head_compares_only_identical_buoy_target_and_lead():
    """A key is (buoy, target, lead-bucket). Differing on ANY of the three is not a pair."""
    rows = [
        _scored("raw_surf", "B1", "2026-08-10T00:00:00Z", 24, 0.10),
        _scored("other", "B2", "2026-08-10T00:00:00Z", 24, 0.90),   # different buoy
        _scored("other", "B1", "2026-08-11T00:00:00Z", 24, 0.90),   # different target
        _scored("other", "B1", "2026-08-10T00:00:00Z", 72, 0.90),   # different lead bucket
    ]
    assert head_to_head(rows) == [], "none of those three share a key with ours"


def test_head_to_head_is_silent_rather_than_wrong_with_no_primary_rows():
    rows = [_scored("persistence", "B1", "2026-08-10T00:00:00Z", 24, 0.3)]
    assert head_to_head(rows) == []
    assert head_to_head([]) == []


def test_head_to_head_ignores_rows_with_no_error_the_same_way_the_summary_does():
    rows = [
        _scored("raw_surf", "B1", "2026-08-10T00:00:00Z", 24, None),
        _scored("persistence", "B1", "2026-08-10T00:00:00Z", 24, 0.3),
        _scored("raw_surf", "B1", "2026-08-10T01:00:00Z", 24, 0.1),
        _scored("persistence", "B1", "2026-08-10T01:00:00Z", 24, 0.3),
    ]
    h = [c for c in head_to_head(rows) if c["source"] == "persistence"][0]
    assert h["n_paired"] == 1, "an unscored row is not a pair"
