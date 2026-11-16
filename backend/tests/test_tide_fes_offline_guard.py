"""M1 tide gate (offline). PyFES is GPL (director 2026-11-15): it runs only in the offline Actions job
(scripts/tide_fes/); the served backend serves its OUTPUT and never imports it or that folder. The gate's rules are
pure functions (scripts/tide_fes/metrics.py), pinned here against the reconciled pre-registration (22:25 EST)."""
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PAT = re.compile(r"^\s*(import\s+pyfes|from\s+pyfes\b|.*\btide_fes\b.*import|import\s+.*\btide_fes\b)", re.M)


def test_served_backend_never_imports_pyfes_or_the_offline_job():
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    hits = [str(p.relative_to(BACKEND)) for p in served if p.is_file() and PAT.search(p.read_text(encoding="utf-8", errors="ignore"))]
    assert hits == []
    assert not re.search(r"(?im)^\s*pyfes", (BACKEND / "requirements.txt").read_text(encoding="utf-8"))


def test_the_guard_pattern_catches_the_forms_it_must():
    for bad in ("import pyfes", "from pyfes import config", "from scripts.tide_fes import fes_gate", "import scripts.tide_fes.fes_gate"):
        assert PAT.search(bad), bad
    assert not PAT.search("# reads tides/fes/*.json written by the offline job")


def test_aviso_credentials_go_only_to_a_pinned_host_and_names_stay_plain():
    """Security review 2026-11-15: verify the host key BEFORE auth; accept only plain file names from listings/archives."""
    from scripts.tide_fes import sources as S
    kind, b64 = next(iter(S.AVISO_HOST_KEYS))
    assert S.host_key_ok(kind, b64) and not S.host_key_ok(kind, b64[:-4] + "AAAA") and not S.host_key_ok("ssh-rsa", b64)
    assert S.remote_name_ok("m2_fes2022.nc.xz") and S.remote_name_ok("2n2_fes2022.nc.xz")
    for bad in ("../m2_fes2022.nc.xz", "x/m2_fes2022.nc.xz", "m2_fes2022.nc", "M2_FES2022.nc.xz", "m2_fes2022.nc.xz\n"):
        assert not S.remote_name_ok(bad), bad
    assert S.eot20_member_ok("EOT20/ocean_tides/M2_ocean_eot20.nc") and S.eot20_member_ok("ocean_tides/2N2_ocean_eot20.nc")
    for bad in ("../ocean_tides/M2_ocean_eot20.nc", "/abs/M2_ocean_eot20.nc", "EOT20/load_tides/M2_load_eot20.nc"):
        assert not S.eot20_member_ok(bad), bad
    assert S.eot20_outer_ok("ocean_tides.zip") and S.eot20_outer_ok("EOT20/ocean_tides.zip")
    for bad in ("load_tides.zip", "../ocean_tides.zip", "x/ocean_tides.zip.bak", "/ocean_tides.zip"):
        assert not S.eot20_outer_ok(bad), bad
    src = (BACKEND / "scripts" / "tide_fes" / "sources.py").read_text(encoding="utf-8")
    assert src.index("host_key_ok(key.get_name()") < src.index("t.auth_password(") and "t.connect(" not in src


def _arm(rmse, hilo=5.0, mllw=0.01):
    return {"rmse": rmse, "hilo_med": hilo, "mllw_err": mllw}


def test_gate_items_follow_the_reconciled_preregistration():
    from scripts.tide_fes import metrics as M
    c = {s: _arm(0.12) for s in "abcde"}
    good = M.arm_verdict({s: _arm(0.05) for s in "abcde"}, c)
    assert good["pass"] and good["median_rmse_m"] == 0.05
    assert not M.arm_verdict({s: _arm(0.085) for s in "abcde"}, c)["items"]["1_rmse"]         # above 0.08
    assert not M.arm_verdict({s: _arm(0.05) for s in "abcde"}, {s: _arm(0.04) for s in "abcde"})["items"]["1_rmse"]  # not below C
    one_bad = {**{s: _arm(0.05) for s in "abcd"}, "e": _arm(0.18)}                              # 0.06 worse than C at e
    v = M.arm_verdict(one_bad, c)
    assert v["stations_worse_than_C"] == ["e"] and not v["pass"]
    missing = {s: _arm(0.05) for s in "abcd"}                                                   # C scores e, the arm cannot
    assert M.arm_verdict(missing, c)["stations_worse_than_C"] == ["e"]
    assert not M.arm_verdict({s: _arm(0.05, hilo=21.0) for s in "abcde"}, c)["items"]["3_timing"]
    assert not M.arm_verdict({s: _arm(0.05, hilo=math.inf) for s in "abcde"}, c)["items"]["3_timing"]
    assert not M.arm_verdict({s: _arm(0.05, mllw=-0.06) for s in "abcde"}, c)["items"]["4_mllw"]


def test_choice_tie_goes_to_fes_and_controls_void_the_result():
    from scripts.tide_fes import metrics as M
    c = {s: _arm(0.12) for s in "abc"}
    va, vb = M.arm_verdict({s: _arm(0.060) for s in "abc"}, c), M.arm_verdict({s: _arm(0.052) for s in "abc"}, c)
    assert M.choose({"A": va, "B": vb}) == "A"                                                   # within 0.01 m
    vb2 = M.arm_verdict({s: _arm(0.040) for s in "abc"}, c)
    assert M.choose({"A": va, "B": vb2}) == "B"
    vfail = M.arm_verdict({s: _arm(0.05, hilo=40) for s in "abc"}, c)
    assert M.choose({"A": vfail, "B": vb2}) == "B" and M.choose({"A": va, "B": vfail}) == "A"   # passing arms first
    items, ok = M.controls_ok(0.004, 0.45, 180.0)
    assert ok and all(items.values())
    for bad in ((0.02, 0.45, 180.0), (0.004, 0.25, 180.0), (0.004, 0.45, 12.0), (None, 0.45, 180.0)):
        assert not M.controls_ok(*bad)[1], bad
    assert M.final({"A": va, "B": vb}, False) == ("A", "VOID") and M.final({"A": va, "B": vb}, True) == ("A", "PASS")
    assert M.final({"A": vfail, "B": M.arm_verdict({s: _arm(0.09) for s in "abc"}, c)}, True)[1] == "FAIL"


def test_extrema_timing_and_mllw_on_a_known_tide():
    from scripts.tide_fes import metrics as M
    t0 = datetime(2026, 10, 15, tzinfo=timezone.utc)
    period_h = 12.42
    fine = [t0 + timedelta(minutes=6 * k) for k in range(10 * 24 * 10)]
    h = lambda t: math.cos(2 * math.pi * ((t - t0).total_seconds() / 3600) / period_h)       # noqa: E731
    ex = M.extrema(fine, [h(t) for t in fine])
    truth = [(t0 + timedelta(hours=period_h * k), "H") for k in range(1, 15)]
    truth += [(t0 + timedelta(hours=period_h * (k + 0.5)), "L") for k in range(1, 15)]
    assert max(M.hilo_errors(truth, ex)) < 1.0                                                  # parabolic refinement
    shifted = [(t + timedelta(hours=6), k) for t, k in ex]
    assert all(e == math.inf for e in M.hilo_errors(truth, shifted))                            # the +6 h control fails
    vals = [h(t0 + timedelta(minutes=10 * k)) for k in range(6 * 24 * 60)]
    assert abs(M.mllw_offset(vals, 10 / 60) - 1.0) < 0.01                                      # MSL - MLLW of cos = 1
    d = M.derangements(26)
    assert len(d) == 200 == len({tuple(p) for p in d}) and all(i != v for p in d for i, v in enumerate(p))
    assert M.stratum("1612340") == "Hawaii" and M.stratum("8771510") == "Gulf" and M.stratum("8443970") == "Atlantic"
