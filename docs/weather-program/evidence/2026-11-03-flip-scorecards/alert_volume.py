"""Usage: STEP=1 SIG=1.0 [TIERS=premium] python alert_volume.py <backend dir> <data dir> <out.json>

Volume + tier check for ALERTS_FORECAST_WINDOWS on top of backend/scripts/alert_window_replay.py (offline).
Per (preference class, tier): fires per user-day, the max fires in any one local day for one user, and whether
every fired window lies inside send time + the tier's horizon. A "user" = one (spot, class, seed) replay."""
import json
import os
import random
import sys
import types
from collections import Counter
from datetime import timedelta

BACKEND = sys.argv[1]
DATA = sys.argv[2]
OUT = sys.argv[3]
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
os.environ["ALERTS_FORECAST_WINDOWS"] = "1"
import alert_window_replay as R  # noqa: E402
from services import surf_alert_windows as W  # noqa: E402

TIERS = os.environ.get("TIERS", "free,basic,premium").split(",")
SEEDS = 5
SIG = float(os.environ.get("SIG", "1.0"))
STEP = int(os.environ.get("STEP", "1"))
rows = []
for spot in R.SPOTS:
    geo = R.resolve_surf_geometry(spot["lat"], spot["lng"])
    obs = R.build(spot, DATA)
    off = W.local_offset_h(spot["lng"])
    hours = sorted(obs)
    first, last = hours[0], hours[-1] - timedelta(hours=72)
    for cls, kw in R.ALERTS.items():
        for seed in range(SEEDS):
            rng = random.Random(seed)
            issues, t = {}, first.replace(hour=(first.hour // 4) * 4)
            while t <= last:
                issues[t] = R.issue(spot, geo, obs, t, SIG, rng, STEP)
                t += timedelta(hours=4)
            for tier in TIERS:
                spot_ns = types.SimpleNamespace(name=spot["name"], latitude=spot["lat"], longitude=spot["lng"])
                alert = types.SimpleNamespace(id="a", spot_id=spot["name"], min_wave_height=None, max_wave_height=None,
                                              time_windows=None, tide_states=None, preferred_conditions=None)
                for k, v in kw.items():
                    setattr(alert, k, v)
                sent, fires, outside = [], [], 0
                run = first + timedelta(hours=1)
                while run <= last:
                    cur = max((i for i in issues if i + timedelta(hours=1) <= run), default=None)
                    if cur is not None:
                        d = W.decide(alert, spot_ns, issues[cur], run, notified=sent, subscription_tier=tier)
                        if d["fire"]:
                            a, b = W.parse_time(d["window"]["start"]), W.parse_time(d["window"]["end"])
                            sent.append((a, b))
                            fires.append(run)
                            if b > run + timedelta(hours=W.horizon_h(tier, d["model"])):
                                outside += 1
                    run += timedelta(hours=1)
                days = (last - first).total_seconds() / 86400
                per_day = Counter((f + timedelta(hours=off)).date() for f in fires)
                rows.append({"spot": spot["name"], "cls": cls, "seed": seed, "tier": tier, "fires": len(fires),
                             "days": days, "max_day": max(per_day.values()) if per_day else 0,
                             "outside_tier": outside, "horizon_h": W.horizon_h(tier, "GFS"),
                             "hist": dict(Counter(per_day.values())), "user_days": int(round(days))})
agg = {}
for r in rows:
    a = agg.setdefault((r["cls"], r["tier"]), {"k": 0, "fires": 0, "days": 0.0, "max_day": 0, "outside": 0,
                                               "horizon_h": r["horizon_h"]})
    a["k"] += 1
    a["fires"] += r["fires"]
    a["days"] += r["days"]
    a["max_day"] = max(a["max_day"], r["max_day"])
    a["outside"] += r["outside_tier"]
summary = [{"class": c, "tier": t, "k_users": a["k"], "fires_per_user_day": round(a["fires"] / a["days"], 3),
            "max_fires_one_user_one_day": a["max_day"], "fires_outside_tier_window": a["outside"],
            "tier_horizon_h": a["horizon_h"]} for (c, t), a in sorted(agg.items())]
for s in summary:
    print(s)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump({"sigma": SIG, "seeds": SEEDS, "summary": summary, "window": [str(hours[0]), str(hours[-1])]}, fh,
              indent=1, default=str)
H = {}
for r in rows:
    h = H.setdefault(r["cls"], Counter())
    for k, v in r["hist"].items():
        h[k] += v
    h[0] += r["user_days"] - sum(r["hist"].values())
print("HIST per class (fires in one local day -> user-days):", {c: dict(sorted(h.items())) for c, h in H.items()})
