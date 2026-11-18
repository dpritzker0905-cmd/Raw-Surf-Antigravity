"""M1-0 parity probe (CMEMS merged sea level read directly vs the served Open-Meteo level). Pins the rule fixed before
any run (held keys, hindcast-only gating, the 0.01 m p99 line, the pair-share floor, only the primary gates), the cell
pickers, the one-shot workflow with its credential on one step, and that no observed water and nothing served is
touched."""
import re
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts" / "tide_cmems"))
import parity_rules as PR                                # noqa: E402

PROBE = (BACKEND / "scripts" / "tide_cmems" / "parity_probe.py").read_text(encoding="utf-8")
WF = (BACKEND.parent / ".github" / "workflows" / "tide-cmems-parity.yml").read_text(encoding="utf-8")


def test_rule_is_fixed_before_any_run():
    assert PR.DATASET == "cmems_mod_glo_phy_anfc_merged-sl_PT1H-i"
    assert (PR.LINE_M, PR.QUANTILE, PR.HINDCAST_H, PR.MIN_PAIR_SHARE) == (0.01, 99, 48, 0.90)
    assert len(PR.HELD_KEYS) == 20 and len(set(PR.HELD_KEYS)) == 20
    assert all(round(a, 1) == a and round(b, 1) == b for a, b in PR.HELD_KEYS)       # served 0.1-degree keys
    assert PR.PRIMARY == "total_sea_level@nearest" and PR.CANDIDATES[PR.PRIMARY] == ("nearest", ("total_sea_level",))


def test_verdict_line_and_pair_floor():
    exp = 100
    assert PR.verdict([0.005] * 95 + [0.02] * 1, exp) == "PASS"            # p99 still <= 0.01
    assert PR.verdict([0.005] * 80 + [0.02] * 15, exp) == "MISS"
    assert PR.verdict([0.0] * 89, exp) == "NOT ENOUGH PAIRS"
    assert PR.verdict([float("nan")] * 100, exp) == "NOT ENOUGH PAIRS"


def test_only_the_primary_hindcast_pairs_gate():
    assert "PR.verdict(pairs[PR.PRIMARY][\"hindcast\"], expected)" in PROBE
    assert PROBE.count("PR.verdict(") == 1


def test_cell_pickers():
    lats, lons = np.arange(20.0, 22.0, 1 / 12), np.arange(-159.0, -157.0, 1 / 12)
    iy, ix = PR.nearest_cell(lats, lons, (21.3, -157.9))
    assert abs(lats[iy] - 21.3) <= 1 / 24 and abs(lons[ix] + 157.9) <= 1 / 24
    wet = np.zeros((lats.size, lons.size), bool)
    wet[0, 0] = True
    assert PR.nearest_wet_cell(lats, lons, (21.3, -157.9), wet) == (0, 0)
    assert PR.nearest_wet_cell(lats, lons, (21.3, -157.9), np.zeros_like(wet)) is None
    lon360 = np.array([179.9, -179.9])
    assert PR.nearest_cell(np.array([0.0]), lon360, (0.0, -179.95)) in ((0, 0), (0, 1))


def test_combine_and_stats():
    c = {"a": [1.0, np.nan], "b": [0.5, 0.5]}
    out = PR.combine(c, ("a", "b"))
    assert out[0] == 1.5 and np.isnan(out[1])
    assert PR.combine({"t": [1.0], "l": [0.25]}, ("t", "-l"))[0] == 0.75     # TOTAL - load
    assert PR.CANDIDATES["total_minus_load@nearest"] == ("nearest", ("total_sea_level", "-tide_loading"))
    assert "parts_with_load@nearest" in PR.CANDIDATES and PR.PRIMARY == "total_sea_level@nearest"   # gate unchanged
    s = PR.stats([0.0, 0.01, np.nan])
    assert s["n"] == 2 and s["max_m"] == 0.01
    assert PR.stats([])["n"] == 0


def test_probe_reads_model_values_only():
    for truth in ("water_level", "datagetter", "tidesandcurrents", "uhslc", "erddap"):
        assert truth not in PROBE.lower()
    assert "marine-api.open-meteo.com" in PROBE and "copernicusmarine.subset" in PROBE


def test_workflow_is_one_shot_with_the_credential_on_one_step():
    code = "\n".join(ln.split("#")[0] for ln in WF.splitlines())
    assert "tags: [tide-cmems-parity]" in code and "workflow_dispatch" not in code and "schedule" not in code
    steps = re.split(r"\n      - ", WF)
    cred = [s for s in steps if "COPERNICUSMARINE_SERVICE_PASSWORD" in s]
    assert len(cred) == 1 and "parity_probe.py" in cred[0]
    assert WF.count("secrets.") == 2 and "contents: write" not in WF


def test_served_backend_never_imports_the_probe():
    pat = re.compile(r"^\s*(from|import)\s+.*\b(tide_cmems|parity_probe|parity_rules)\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p.name for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []
