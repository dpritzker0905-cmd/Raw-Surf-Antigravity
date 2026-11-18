"""G1a: the consensus guard read from the scored ledger (services/weather_pipeline/consensus_ledger_guard.py).

Synthetic rows only. Pins: the null and shuffled-day controls stay quiet and every planted harm is caught (the +6 deg
rotation and the +0.06 m level by the SIGNED test itself); a real harm in a stored tier class fires while the same harm in
`any-unknown` is only a coverage alarm; a steady rotation that leaves the circular MAE flat still fires; too few pairs
reads INSUFFICIENT, never NO_FIRE; the same seed gives the same answer; the renderer never prints a buoy id, a target
time or a window date."""
import random
from datetime import datetime, timedelta, timezone

from services.weather_pipeline import consensus_ledger_guard as g

NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
BUOYS = ("46025", "46086", "46053", "51201", "51202", "51101", "44025", "44013", "44008", "41002", "41025", "42040")
HOURS = tuple(range(0, 24, 2))
REPS = 1000       # the module's 2,000 in production. Not lower: the smallest bootstrap p is 1/(REPS+1), and Holm
                  # multiplies it by the number of basin x lead cells (18 here), which must stay under 0.025


def rows(harm_hs=0.0, harm_dir=0.0, rot_dir=0.0, tiers=("regional", "regional"), days=14, hours=HOURS, buoys=BUOYS,
         seed=7):
    """Served and shadow rows on the same observation, plus the ICON / EURO member rows that carry the tier.
    harm_* grows the shadow's |error| by that much; rot_dir rotates the shadow's direction by that many degrees."""
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
                    for src, tier in ((g.ICON, tiers[0]), (g.EURO, tiers[1])):
                        r = dict(base, source=src, hs_m=obs + e, err_m=e)
                        if tier:
                            r["tier"] = tier
                        out.append(r)
    return out


CLEAN = rows()


def items(**kw):
    return g.items_from_rows(rows(**kw) if kw else CLEAN, NOW)


def test_items_drop_ids_and_times_and_keep_the_window():
    it = items()
    assert it and all(set(x) <= {"day", "lead", "basin", "tier", "obs", g.HS, g.DIR} for x in it)
    assert {x["day"] for x in it} <= set(g.window_days(NOW))
    assert NOW.date().isoformat() not in {x["day"] for x in it}            # today is incomplete and excluded


def test_wrap180_folds_to_the_half_open_interval():
    assert g.wrap180(190) == -170 and g.wrap180(-180) == 180 and g.wrap180(540) == 180 and g.wrap180(-10) == -10


def test_no_harm_does_not_fire_and_every_control_behaves():
    for q in (g.HS, g.DIR):
        r = g.verdict(items(), q, reps=REPS)
        assert r["state"] == g.NO_FIRE, (q, r["why"])
        assert all(r["controls"].values()), (q, r["controls"])


def test_the_threshold_sized_direction_plant_is_caught_and_the_rotation_by_the_signed_test():
    it = items()
    caught = g.judge(g.planted_items(it, g.DIR, "share", 15.0), g.DIR, reps=REPS)
    assert caught["fire"] and g.MAE in caught["fired"]
    rot = g.judge(g.planted_items(it, g.DIR, "basin", 6.0), g.DIR, reps=REPS)
    assert g.BIAS in rot["fired"]


def test_a_steady_rotation_fires_even_though_the_mae_barely_moves():
    r = g.verdict(items(rot_dir=8.0), g.DIR, reps=REPS)
    assert r["state"] == g.FIRE and g.BIAS in r["fired"]


def test_real_hs_harm_in_a_stored_class_fires():
    r = g.verdict(items(harm_hs=0.05), g.HS, reps=REPS)
    assert r["state"] == g.FIRE and any("stored-regional pooled" in w for w in r["why"])


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


def test_same_seed_same_answer():
    it = items(harm_hs=0.01)
    assert g.verdict(it, g.HS, reps=REPS, seed=11) == g.verdict(it, g.HS, reps=REPS, seed=11)


def test_a_positive_control_that_cannot_fire_voids_the_verdict(monkeypatch):
    monkeypatch.setitem(g.PLANTS, g.HS, (("nothing planted", "share", 0.0, None),))
    r = g.verdict(items(), g.HS, reps=REPS)
    assert r["state"] == g.VOID and "nothing planted" in r["why"][0]


def test_render_never_prints_an_id_a_time_or_a_date():
    report = {f: dict(g.verdict(items(harm_hs=0.05), q, reps=REPS), quantity=q, role=role)
              for f, (q, role) in g.FLAGS.items()}
    text = g.render(report)
    assert "CONSENSUS_DIRECTION_VECTOR" in text and "READINESS (pre-flip; no kill path)" in text
    for b in BUOYS:
        assert b not in text
    assert "2026-" not in text and "T00:00" not in text


def test_small_cells_are_suppressed_at_birth():
    assert g._public({"n": 9, "delta": 1.0, "lo": 0.5, "hi": 1.5, "p": 0.0}) == {"suppressed": True}
    assert "p" not in g._public({"n": 10, "delta": 1.0, "lo": 0.5, "hi": 1.5, "p": 0.0})
