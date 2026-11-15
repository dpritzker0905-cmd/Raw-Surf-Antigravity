"""The EURO scalar shadow read (pre-registered 2026-11-15): verdicts, controls and aggregates-only output, on synthetic rows."""
import random
from datetime import datetime, timedelta, timezone

from scripts import euro_scalar_shadow_read as R

NOW = datetime(2026, 11, 15, 18, tzinfo=timezone.utc)
SINCE = datetime(2026, 11, 2, tzinfo=timezone.utc)
BUOYS = ["41%03d" % i for i in range(6)] + ["46%03d" % i for i in range(6)]


def _rows(scalar_delta=0.0, n_days=13, per_day=4, seed=1, buoys=BUOYS):
    """Paired V and S rows: S's error = V's error + scalar_delta in magnitude, same observation."""
    rng = random.Random(seed)
    out = []
    for d in range(n_days):
        day = SINCE + timedelta(days=d)
        for h in range(per_day):
            t = (day + timedelta(hours=6 * h)).strftime("%Y-%m-%dT%H:00Z")
            for b in buoys:
                for lead in R.LEADS:
                    ev = rng.gauss(0.05, 0.25)
                    es = ev + (scalar_delta if ev >= 0 else -scalar_delta)
                    obs = {"obs_time": t, "obs_hs_m": 1.5}
                    out.append({"source": R.VECTOR, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": ev, **obs})
                    out.append({"source": R.SCALAR, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": es, **obs})
    return out


def _verdict(rows):
    res = R.read(R.index_rows(rows, SINCE, NOW))
    return R.verdict(res), R.lines(res)[0]


def test_a_scalar_that_is_better_supports_the_flip():
    (valid, _, call, _), _ = _verdict(_rows(scalar_delta=-0.03))
    assert valid and call == "SUPPORTS"


def test_a_scalar_that_is_worse_is_against():
    (valid, _, call, _), _ = _verdict(_rows(scalar_delta=+0.08))
    assert valid and call == "AGAINST"


def test_controls_hold_on_a_clean_ledger_and_identity_is_exactly_zero():
    res = R.read(R.index_rows(_rows(), SINCE, NOW))
    for lead in R.LEADS:
        c = res["controls"][lead]
        assert c["c0_identity"] == 0.0
        assert c["c1_null_i3"][0] <= 0 <= c["c1_null_i3"][1]
        assert c["c2_plant_i3"][0] > 0


def test_too_few_buoys_or_pairs_is_void_never_a_verdict():
    (valid, reasons, call, _), _ = _verdict(_rows(buoys=BUOYS[:3]))
    assert not valid and call == "VOID" and any("coverage" in r for r in reasons)


def test_unpaired_or_mismatched_observations_are_not_paired():
    rows = _rows()
    for r in rows:
        if r["source"] == R.SCALAR and r["buoy_id"] == BUOYS[0]:
            r["obs_hs_m"] = 9.9
    res = R.read(R.index_rows(rows, SINCE, NOW))
    assert all(res["coverage"][lead]["obs_mismatch"] > 0 for lead in R.LEADS)
    assert all(res["coverage"][lead]["buoys"] == len(BUOYS) - 1 for lead in R.LEADS)


def test_output_is_aggregates_only():
    _, text = _verdict(_rows(scalar_delta=-0.02))
    blob = "\n".join(text)
    assert not any(b in blob for b in BUOYS), "a buoy id reached the printed output"
    assert "obs_hs_m" not in blob and "err_m" not in blob and "T00Z" not in blob
    assert "VERDICT" in blob


def test_holm_steps_down():
    assert R.holm([("a", 0.001), ("b", 0.04), ("c", 0.5)]) == {"a": True, "b": False, "c": False}
    assert R.holm([("a", 0.01), ("b", 0.02)]) == {"a": True, "b": True}
