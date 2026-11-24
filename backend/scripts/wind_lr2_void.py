"""wind_lr2_void.py - "VOID by construction, accepted by the owner before TEST" for the long-range wind v2 registration.

Order of operations (fixed here, before TEST): 1. ELIGIBILITY COUNT (from the frozen station list and the pairing table, nothing else);
2. VOID if fewer than 3 gated regions have >= 10 marine-exposed stations; 3. only THEN the holdout (amendment L1) and score-time coverage.
A run that is VOID by construction is DESCRIPTIVE ONLY: it computes what `docs/.../wind-long-range-v2-descriptive-only.md` lists, carries a
VOID stamp in every JSON section and every table, has VOID in every file name, and can never be read as a verdict or shipped. No skill
conclusion, positive or negative, may be drawn from it. Pure functions; reads no data by itself.
"""
import copy
import json
import os
import sys
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wind_lr2_runs as R  # noqa: E402
import wind_lr2_stats as S  # noqa: E402

STATUS = "VOID_BY_CONSTRUCTION"
TOKEN = "VOID"
NOTICE = ("VOID BY CONSTRUCTION, accepted by the owner before TEST. DESCRIPTIVE ONLY: no skill conclusion, positive or negative, may be "
          "drawn from this output, and nothing ships from it.")
# every key that decides, ranks, passes or ships something: removed from a VOID run's output (the raw p-values and intervals stay)
DECISION_KEYS = frozenset({"pass", "sig", "p_adj", "decision", "ships", "evaluated", "FG", "verdict"})
REPORT_REGIONS = list(R.REGIONS) + ["GREAT_LAKES", "BLACK_SEA", "OTHER"]       # the gated regions first, then the reported-only ones


# ---------------------------------------------------------------------------------------------- 1. the eligibility count
def count_table(stations: Sequence[dict], pairing: Dict[str, dict]) -> List[dict]:
    """One row per region, the same columns for every region: raw (frozen list) and marine-exposed (after pairing) counts."""
    rows = {r: {"region": r, "gated": r in R.REGIONS, "raw_ndbc": 0, "raw_asos": 0, "marine_ndbc": 0, "marine_asos": 0,
                "gust_eligible_marine_ndbc": 0} for r in REPORT_REGIONS}
    for st in stations:
        r = R.region_of(st["lat"], st["lon"])
        row = rows.setdefault(r, {"region": r, "gated": r in R.REGIONS, "raw_ndbc": 0, "raw_asos": 0, "marine_ndbc": 0,
                                  "marine_asos": 0, "gust_eligible_marine_ndbc": 0})
        kind = "ndbc" if st.get("kind", "ndbc") == "ndbc" else "asos"
        row[f"raw_{kind}"] += 1
        if pairing.get(str(st["id"]), {}).get("marine"):
            row[f"marine_{kind}"] += 1
            z = st.get("anemometer_m")
            if kind == "ndbc" and z and 1.0 <= float(z) <= 50.0:
                row["gust_eligible_marine_ndbc"] += 1
    return [rows[r] for r in REPORT_REGIONS if r in rows]


def eligibility(table: Sequence[dict]) -> dict:
    """The VOID trigger, stated exactly: the number of GATED regions with >= MIN_STATIONS_PER_REGION marine-exposed stations against
    MIN_REGIONS_WITH_STATIONS, for wind (NDBC + ASOS) and for gust (gust-eligible marine NDBC only)."""
    gated = [r for r in table if r["gated"]]
    wind = [r["region"] for r in gated if r["marine_ndbc"] + r["marine_asos"] >= S.MIN_STATIONS_PER_REGION]
    gust = [r["region"] for r in gated if r["gust_eligible_marine_ndbc"] >= S.MIN_STATIONS_PER_REGION]
    need = S.MIN_REGIONS_WITH_STATIONS
    return {"gated_regions": len(gated), "min_stations_per_region": S.MIN_STATIONS_PER_REGION, "min_regions": need,
            "wind": {"regions_at_or_above_floor": wind, "n": len(wind), "void": len(wind) < need},
            "gust": {"regions_at_or_above_floor": gust, "n": len(gust), "void": len(gust) < need},
            "void": len(wind) < need or len(gust) < need,
            "trigger": (f"{len(wind)} of {len(gated)} gated regions have >= {S.MIN_STATIONS_PER_REGION} marine-exposed stations (wind) and "
                        f"{len(gust)} of {len(gated)} have >= {S.MIN_STATIONS_PER_REGION} gust-eligible marine NDBC stations (gust); "
                        f"the threshold is {need}")}


def render_table(table: Sequence[dict]) -> str:
    """The same columns and the same formatting for every region: no row is highlighted."""
    head = ("| region | gated | raw NDBC | raw ASOS | marine NDBC | marine ASOS | gust-eligible marine NDBC | marine (NDBC+ASOS) >= "
            f"{S.MIN_STATIONS_PER_REGION} |\n|---|---|---|---|---|---|---|---|\n")
    body = "".join(f"| {r['region']} | {'yes' if r['gated'] else 'no'} | {r['raw_ndbc']} | {r['raw_asos']} | {r['marine_ndbc']} | "
                   f"{r['marine_asos']} | {r['gust_eligible_marine_ndbc']} | "
                   f"{'yes' if r['marine_ndbc'] + r['marine_asos'] >= S.MIN_STATIONS_PER_REGION else 'no'} |\n" for r in table)
    return head + body


def counts_document(stations: Sequence[dict], pairing: Dict[str, dict], inputs: dict) -> dict:
    t = count_table(stations, pairing)
    return {"status": STATUS, "notice": NOTICE, "inputs": inputs, "table": t, "eligibility": eligibility(t),
            "order_of_operations": ["eligibility count (frozen list + pairing only)", "VOID decision",
                                    "holdout (amendment L1) and score-time coverage"]}


# ---------------------------------------------------------------------------------------------- 2. stamping a run's outputs
def header() -> dict:
    return {"status": STATUS, "void": True, "notice": NOTICE, "descriptive_only": True, "ships": False}


def _strip(x):
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k not in DECISION_KEYS}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


def descriptive(doc: dict) -> dict:
    """The VOID form of a score document: decision, pass, significance-flag and ship fields removed everywhere, the verdict replaced,
    every top-level section stamped. Computed lines keep their means, intervals, counts and raw p-values."""
    out = _strip(copy.deepcopy(doc))
    for k in ("verdict", "void_reasons"):
        out.pop(k, None)
    out["tails"] = {}                                   # no per-tail decision exists in a VOID run
    stamped = {}
    for k, v in out.items():
        stamped[k] = dict(v, _void=True) if isinstance(v, dict) else v
    if isinstance(stamped.get("gust"), dict):
        stamped["gust"]["tails"] = {}
        for k, v in list(stamped["gust"].items()):
            if isinstance(v, dict):
                stamped["gust"][k] = dict(v, _void=True)
    return {**header(), "verdict": STATUS, **stamped}


def stamp_path(path: str) -> str:
    """report.json -> report.VOID.json (the token goes before the extension)."""
    root, ext = os.path.splitext(path)
    return root + "." + TOKEN + ext


def render_markdown(doc: dict, table: Optional[Sequence[dict]] = None) -> str:
    out = [f"# {STATUS}", "", f"**{NOTICE}**", ""]
    if table:
        out += ["## Eligibility count (frozen list + pairing, before any holdout or coverage)", "", render_table(table), ""]
    for name, sec in doc.items():
        if isinstance(sec, dict) and name not in ("tails",):
            out += [f"## {name}", "", f"_{STATUS}: descriptive only_", "", "```json", json.dumps(sec, indent=1, default=float, sort_keys=True)[:6000], "```", ""]
    return "\n".join(out) + "\n"


def write_outputs(doc: dict, out_path: str, table: Optional[Sequence[dict]] = None) -> List[str]:
    """Write the stamped JSON and its markdown table under VOID-tokened names; returns the paths. Nothing else is written."""
    d = descriptive(doc)
    jpath = stamp_path(out_path)
    mpath = os.path.splitext(jpath)[0] + ".md"
    json.dump(d, open(jpath, "w", encoding="utf-8"), indent=1, default=float)
    open(mpath, "w", encoding="utf-8", newline="\n").write(render_markdown(d, table))
    return [jpath, mpath]


# ---------------------------------------------------------------------------------------------- 3. never a verdict, never shipped
class NotShippable(Exception):
    pass


def assert_shippable(doc: dict) -> dict:
    """Every consumer that could act on a score document calls this first: a VOID document is refused."""
    if doc.get("status") == STATUS or doc.get("void") is True or doc.get("verdict") in (STATUS, "VOID"):
        raise NotShippable("VOID by construction: descriptive only; nothing ships from this test")
    return doc


def main(argv=None) -> int:
    """`counts --stations F --pairing F --out-md F --out-json F`: regenerate the committed eligibility count (pure, offline)."""
    import argparse
    import hashlib
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["counts"])
    ap.add_argument("--stations", required=True)
    ap.add_argument("--pairing", required=True)
    ap.add_argument("--out-md", required=True)
    ap.add_argument("--out-json", required=True)
    a = ap.parse_args(argv)
    sb, pb = open(a.stations, "rb").read(), open(a.pairing, "rb").read()
    st = json.loads(sb)
    doc = counts_document(st["ndbc"] + st["asos"], json.loads(pb),
                          {"stations_sha256": hashlib.sha256(sb).hexdigest(), "pairing_sha256": hashlib.sha256(pb).hexdigest()})
    json.dump(doc, open(a.out_json, "w", encoding="utf-8", newline="\n"), indent=1, sort_keys=True)
    open(a.out_md, "w", encoding="utf-8", newline="\n").write(
        f"# Eligibility count: {STATUS}\n\n**{NOTICE}**\n\nInputs: stations sha256 `{doc['inputs']['stations_sha256']}`, pairing sha256 "
        f"`{doc['inputs']['pairing_sha256']}`. Order of operations: eligibility count, then VOID, then holdout and coverage.\n\n"
        f"{render_table(doc['table'])}\n**VOID trigger:** {doc['eligibility']['trigger']}.\n")
    print(doc["eligibility"]["trigger"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
