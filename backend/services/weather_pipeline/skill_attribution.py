"""skill_attribution.py — WHERE our same-model accuracy gap comes from (2026-09-27).

The forecast accuracy monitor's PAIRED head-to-head (same buoy x target x lead AND verifying observation,
~2,400 pairs per lead) says our GFS lane loses to Open-Meteo's copy of the SAME model:
    +24 h 0.275 vs 0.252 · +48 h 0.302 vs 0.274 · +72 h 0.359 vs 0.330 m  (win rate 40%)
Same model, same buoys, same hours: the difference is lost in our serving path. Probed live that day, three
candidates, none measurable from the ledger as it stood:
  * TIER — 9 of 51 calibration buoys sit outside every regional tile and are answered from `global_mid`, a
    2 deg grid; at a matched frame those differ from Open-Meteo's native 0.25 deg by 0.209 m mean against
    0.044-0.078 m for the regional tiles;
  * CYCLE — at 02:43Z `global_mid`/`global_coarse` were on the 12Z GFS cycle while the regional tiles and
    Open-Meteo were on 18Z;
  * FRAME — the resolver answers an off-cycle hour from the nearest 3-hourly frame (04Z from 03Z) and
    relabels it as the hour asked for.
So each ledger row now carries its serving provenance (`serving_provenance`), and `same_model_attribution`
splits the paired gap along those three axes. Rows ledgered before this read as `unknown`.
"""
import re
from datetime import timedelta
from typing import Dict, List, Optional

SAME_MODEL_CONTROL = "open_meteo:ncep_gfswave025"
STALE_CYCLE_H = 9.0          # a GFS cycle is 6 h old at most once the next one has been ingested
_FRAME_RE = re.compile(r"(\d{8}T\d{6}Z)")


def tier_of(product_id: Optional[str]) -> Optional[str]:
    if not product_id:
        return None
    pid = str(product_id)
    if "global_mid" in pid:
        return "global_mid"
    if "global_coarse" in pid:
        return "global_coarse"
    if pid.startswith("dyn") or "viewport" in pid:
        return "dynamic"
    return "regional"


def serving_provenance(product_id, cycle_iso, target_time, lead_h) -> Dict:
    """PURE: {tier, frame_off_h, cycle_age_h} for one ledger row, only the keys that are known.

    frame_off_h = target hour minus the frame that answered (0 = on-frame; +-1..1.5 = snapped).
    cycle_age_h = ledger time (target - lead) minus the model cycle that answered."""
    from services.weather_pipeline.forecast_skill import _parse_iso
    out: Dict = {}
    tier = tier_of(product_id)
    if tier:
        out["tier"] = tier
    target = _parse_iso(target_time)
    m = _FRAME_RE.search(str(product_id or ""))
    frame = _parse_iso(f"{m.group(1)[:4]}-{m.group(1)[4:6]}-{m.group(1)[6:8]}T{m.group(1)[9:11]}:"
                       f"{m.group(1)[11:13]}:{m.group(1)[13:15]}Z") if m else None
    if target is not None and frame is not None:
        out["frame_off_h"] = round((target - frame).total_seconds() / 3600.0, 2)
    cycle = _parse_iso(cycle_iso)
    if target is not None and cycle is not None and isinstance(lead_h, (int, float)):
        out["cycle_age_h"] = round(((target - timedelta(hours=float(lead_h))) - cycle).total_seconds() / 3600.0, 1)
    return out


def _group(values: List[tuple]) -> List[Dict]:
    total = sum(eo - ec for _, eo, ec in values) or None
    groups: Dict[str, List[tuple]] = {}
    for g, eo, ec in values:
        groups.setdefault(g, []).append((eo, ec))
    out = []
    for g, pairs in sorted(groups.items()):
        n = len(pairs)
        mo, mc = sum(p[0] for p in pairs) / n, sum(p[1] for p in pairs) / n
        gap = sum(p[0] - p[1] for p in pairs)
        out.append({"group": g, "n": n, "mae_ours_m": round(mo, 4), "mae_control_m": round(mc, 4),
                    "delta_m": round(mo - mc, 4),
                    "share_of_gap": round(gap / total, 3) if total else None})
    return out


def same_model_attribution(scored_rows, ours: str = "raw_surf", control: str = SAME_MODEL_CONTROL) -> Dict:
    """PURE: the paired ours-vs-control gap split by serving tier, frame snap and cycle age.

    Pairs exactly as `forecast_skill.head_to_head` does — same (buoy, target, lead bucket) AND the same
    verifying observation (time and height) — so a group can never compare different populations."""
    from services.weather_pipeline.forecast_skill import _finite_number, _lead_bucket
    by: Dict[str, Dict[tuple, dict]] = {ours: {}, control: {}}
    for r in scored_rows or []:
        src = r.get("source")
        if src in by and _finite_number(r.get("err_m")):
            by[src][(r.get("buoy_id"), r.get("target_time"), _lead_bucket(r.get("lead_h") or 0))] = r
    tier, frame, cycle = [], [], []
    for key, o in by[ours].items():
        c = by[control].get(key)
        if c is None or o.get("obs_time") != c.get("obs_time") or o.get("obs_hs_m") != c.get("obs_hs_m"):
            continue
        eo, ec = abs(o["err_m"]), abs(c["err_m"])
        tier.append((o.get("tier") or "unknown", eo, ec))
        off = o.get("frame_off_h")
        frame.append(("unknown" if off is None else ("on_frame" if abs(off) < 0.01 else "snapped"), eo, ec))
        age = o.get("cycle_age_h")
        cycle.append(("unknown" if age is None else ("stale" if age >= STALE_CYCLE_H else "fresh"), eo, ec))
    n = len(tier)
    return {"ours": ours, "control": control, "n_paired": n,
            "gap_m": round(sum(eo - ec for _, eo, ec in tier) / n, 4) if n else None,
            "by_tier": _group(tier), "by_frame": _group(frame), "by_cycle": _group(cycle)}
