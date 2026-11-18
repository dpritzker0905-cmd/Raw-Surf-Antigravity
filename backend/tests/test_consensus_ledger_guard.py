"""G1a: the consensus guard read from the scored ledger (services/weather_pipeline/consensus_ledger_guard.py).

Synthetic rows only. Pins: the null and shuffled-day controls stay quiet and every planted harm is caught (rotations and
level shifts by the SIGNED test itself); over 20 seeded reruns the 1.2x plants fire in >= 80 % and the 2x plants in
100 %; +24 h decides on stored-regional rows and +48/+72 h on stored-global_mid + stored-mixed; harm in `any-unknown` is
only a coverage alarm; a steady rotation fires although the circular MAE barely moves; too few pairs is INSUFFICIENT and
too few draws is UNDER_RESOLVED, never NO_FIRE or VOID; the same seed gives the same answer; the renderer never prints a
buoy id, a target time or a window date."""
import random
from datetime import datetime, timedelta, timezone

from services.weather_pipeline import consensus_ledger_guard as g

NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
BUOYS = ("46025", "46086", "46053", "51201", "51202", "51101", "44025", "44013", "44008", "41002", "41025", "42040")
HOURS = tuple(range(0, 24, 2))
# The module's 10,000 in production. Not much lower: a family of m basins is resolved only when 1/(REPS + 1) <=
# 0.025 / (10 m); these rows give m = 5 basins, so REPS must be >= 2,000.
REPS = 2500
AUTO = {24: ("regional", "regional"), 48: ("global_mid", "global_mid"), 72: ("global_mid", "regional")}


def rows(harm_hs=0.0, harm_dir=0.0, rot_dir=0.0, tiers=None, days=14, hours=HOURS, buoys=BUOYS, seed=7):
    """Served and shadow rows on the same observation, plus the ICON / EURO member rows that carry the tier (by default
    each lead's decision class: +24 h regional, +48 h global_mid, +72 h mixed). harm_* grows the shadow's |error| by that
    much; rot_dir rotates the shadow's direction by that many degrees."""
    rng = random.Random(seed)
    out = []
    start = NOW.replace(hour=0) - timedelta(days=days)
    for d in range(days):
        for h in hours:
            t = (start + timedelta(days=d, hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
            for b in buoys:
                obs, mwd = 1.5 + rng.random(), rng.uniform(0, 360)
                for lead in g.LEADS:
                    e, de = rng.gauss(0, 0.3), rng.gauss(0, 15)
                    base = {"buoy_id": b, "target_time": t, "lead_h": float(lead), "obs_time": t, "obs_hs_m": obs,
                            "obs_mwd_deg": mwd}
                    out.append(dict(base, source=g.SERVED, hs_m=obs + e, err_m=e, dir_deg=(mwd + de) % 360))
                    ea = e + (harm_hs if e >= 0 else -harm_hs) + rng.gauss(0, 0.005)
                    da = de + (harm_dir if de >= 0 else -harm_dir) + rot_dir + rng.gauss(0, 0.5)
                    out.append(dict(base, source=g.SHADOW, hs_m=obs + ea, err_m=ea, dir_deg=(mwd + da) % 360))
                    for src, tier in zip((g.ICON, g.EURO), tiers or AUTO[lead]):
                        r = dict(base, source=src, hs_m=obs + e, err_m=e)
                        if tier:
                            r["tier"] = tier
                        out.append(r)
    return out


CLEAN = g.items_from_rows(rows(), NOW)


def items(**kw):
    return g.items_from_rows(rows(**kw), NOW) if kw else CLEAN


def test_items_drop_ids_and_times_and_keep_the_window():
    it = items()
    assert it and all(set(x) <= {"day", "lead", "basin", "tier", "obs", g.HS, g.DIR} for x in it)
    assert {x["day"] for x in it} <= set(g.window_days(NOW))
    assert NOW.date().isoformat() not in {x["day"] for x in it}            # today is incomplete and excluded
    assert {x["tier"] for x in it} == {"stored-regional", "stored-global_mid", "stored-mixed"}


def test_wrap180_folds_to_the_half_open_interval():
    assert g.wrap180(190) == -170 and g.wrap180(-180) == 180 and g.wrap180(540) == 180 and g.wrap180(-10) == -10


def test_resolution_rule():
    assert g.resolved(5, 2000) and not g.resolved(5, 1000) and g.resolved(25, 10000) and not g.resolved(26, 10000)
    assert g.resolved(0, 1)


def test_no_harm_does_not_fire_and_every_control_behaves():
    for q in (g.HS, g.DIR):
        r = g.verdict(items(), q, reps=REPS)
        assert r["state"] == g.NO_FIRE, (q, r["why"])
        assert all(r["controls"].values()), (q, r["controls"])
        assert all(f["resolved"] for f in r["families"])


def test_decision_rows_follow_the_lead():
    j = g.judge(items(), g.HS, reps=REPS)
    assert all(j["decision_n"][lead] > 0 for lead in g.LEADS)
    # mixed rows decide at +72 h, regional rows only at +24 h
    off = g.items_from_rows(rows(tiers=("regional", "regional")), NOW)
    assert [n > 0 for n in g.judge(off, g.HS, reps=REPS)["decision_n"].values()] == [True, False, False]


def test_detection_rate_over_20_seeds():
    """The lead's requirement: the 1.2x plants fire in >= 80 % of seeded reruns, the 2x plants in 100 %."""
    rates = {}
    for q in (g.DIR, g.HS):
        for name, kind, size, must in g.PLANTS[q]:
            hits = 0
            for s in range(20):
                j = g.judge(g.planted_items(CLEAN, q, kind, size, seed=s), q, reps=REPS, seed=s, report=False)
                hits += bool(j["fire"] and (must is None or must in j["fired"]))
            rates[name] = hits / 20
    for name, rate in rates.items():
        assert rate >= (0.8 if "1.2x" in name else 1.0), rates


def test_a_steady_rotation_fires_even_though_the_mae_barely_moves():
    r = g.verdict(items(rot_dir=8.0), g.DIR, reps=REPS)
    assert r["state"] == g.FIRE and g.BIAS in r["fired"]


def test_real_hs_harm_fires():
    r = g.verdict(items(harm_hs=0.05), g.HS, reps=REPS)
    assert r["state"] == g.FIRE and any("pooled" in w for w in r["why"])


def test_harm_where_a_member_has_no_tier_is_a_coverage_alarm_not_a_kill():
    r = g.verdict(items(harm_hs=0.05, tiers=(None, "regional")), g.HS, reps=REPS)
    assert r["state"] == g.INSUFFICIENT and not r["fire"] and r["coverage"]


def test_direction_harm_fires_the_direction_quantity_only():
    it = items(harm_dir=4.0)
    assert g.verdict(it, g.DIR, reps=REPS)["state"] == g.FIRE
    assert g.verdict(it, g.HS, reps=REPS)["state"] == g.NO_FIRE


def test_too_few_pairs_is_insufficient_never_no_fire():
    r = g.verdict(g.items_from_rows(rows(days=3, buoys=BUOYS[:1], hours=(0, 12)), NOW), g.HS, reps=REPS)
    assert r["state"] == g.INSUFFICIENT and r["why"]


def test_too_few_draws_is_under_resolved_never_void_or_no_fire():
    r = g.verdict(items(), g.HS, reps=500)
    assert r["state"] == g.UNDER_RESOLVED and "raise B" in r["why"][0]
    assert "UNDER-RESOLVED" in g.render({"CONSENSUS_SERVE": dict(r, quantity=g.HS, role="readiness")})


def test_same_seed_same_answer():
    it = items(harm_hs=0.01)
    assert g.verdict(it, g.HS, reps=REPS, seed=11) == g.verdict(it, g.HS, reps=REPS, seed=11)


def test_a_positive_control_that_cannot_fire_voids_the_verdict(monkeypatch):
    monkeypatch.setitem(g.PLANTS, g.HS, (("nothing planted", "share", 0.0, None),))
    r = g.verdict(items(), g.HS, reps=REPS)
    assert r["state"] == g.VOID and "nothing planted" in r["why"][0]


def test_render_prints_class_n_and_never_an_id_a_time_or_a_date():
    report = {f: dict(g.verdict(items(harm_hs=0.05), q, reps=REPS), quantity=q, role=role)
              for f, (q, role) in g.FLAGS.items()}
    text = g.render(report)
    assert "CONSENSUS_DIRECTION_VECTOR" in text and "READINESS (pre-flip; no kill path)" in text
    assert "| stored-mixed |" in text and "Resolution: B 2500" in text
    for b in BUOYS:
        assert b not in text
    assert "2026-" not in text and "T00:00" not in text


def test_small_cells_are_suppressed_at_birth():
    assert g._public({"n": 9, "delta": 1.0, "lo": 0.5, "hi": 1.5, "p": 0.0}) == {"suppressed": True}
    assert "p" not in g._public({"n": 10, "delta": 1.0, "lo": 0.5, "hi": 1.5, "p": 0.0})
