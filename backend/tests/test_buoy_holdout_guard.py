"""GUARD (amendment 3 of served-wave-verify-v1; the director's P0, 2026-11-23): every backend module that touches buoy truth
routes through services/buoy_holdout.py, so #1199's LOCKED buoys are fenced everywhere the moment the list is recorded.

A module TOUCHES BUOY TRUTH when it names a buoy-observation host or path (NDBC, CDIP realtime / archive), a shared truth
fetch or parse helper, or a derived store of buoy rows (the skill ledger, gust verification, EMOS, the point archive). Each
such module must call the fence (buoy_holdout.allow_url / drop / keep / is_locked), declare itself a pure collector
(buoy_holdout.declare_collector), or go through the strict served-wave wrapper (point_archive.holdout). Anything else is
listed in EXEMPT with its reason, and an exempt module must not hold a buoy-observation URL. A new reader fails this test
until it is fenced or reviewed."""
import ast
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent

TOUCHES = re.compile(
    r"ndbc\.noaa\.gov|\bNDBC_HOST\b|cdip/(?:realtime|archive)\b"
    r"|\b(?:fetch_ndbc\w*|parse_ndbc\w*|ndbc_get|parse_stdmet|parse_spec|realtime_url)\b"
    r"|calibration/skill|skill/scored|gust_verify/|calibration/emos|point-archive"
    r"|cwwcNDBC\w*|erddap/tabledap/\w*(?:NDBC|ndbc|cdip|CDIP)")
FENCE = re.compile(r"buoy_holdout\.(?:allow_url|drop|keep|is_locked|declare_collector)\(|\bholdout\.state\(")
OBS_URL = re.compile(r"ndbc\.noaa\.gov/(?:data/|view_text_file|download_data)|cdip/(?:realtime|archive)/|tabledap/cwwcNDBC")

EXEMPT = {
    # the fence itself and its strict wrapper
    "services/buoy_holdout.py": "the fence",
    # PURE parsers / writers whose only callers are fenced (they fetch nothing)
    "services/point_archive/qc.py": "pure NDBC parser + URL builder; its fetching callers are fenced (score CLI, probe)",
    "services/point_archive/served_scorer.py": "pure scorer; drops locked rows itself (score(locked=...)) and its CLI is fenced",
    "services/point_archive/writer.py": "archive writer (collection); its callers are the fenced score CLI and the sampler collector",
    "services/weather_pipeline/gate_v2_truth.py": "pure parsers of station METADATA and spectra handed in by the fenced "
                                                  "scripts/gate_v2_ndbc.py; fetches nothing",
    "services/weather_pipeline/skill_direction_period.py": "pure grading over rows its callers load through the fenced "
                                                           "forecast_skill.mos_history_rows / skill_scored_archive.read_month",
    "services/weather_pipeline/l2_retry.py": "generic storage retry; names the ledger prefix in a comment only",
    "scripts/tier_resolution_delta.py": "reads only our own /point API (model output); names the ledger in its docstring",
    # opaque byte transport, pinned to the standard library by their own tests, whose readers are fenced
    "scripts/emos_bucket_io.py": "moves EMOS run files to and from the bucket unparsed; the fit (wind_emos_fit) is fenced",
    "scripts/gust_bucket_io.py": "moves gust-verify files to and from the bucket unparsed; the scorer (gust_verify_score) is fenced",
    "scripts/admin_ops_bucket_io.py": "admin ops snapshot (#1239): COUNTS objects under the gust-verify and point-archive "
                                      "prefixes and reads only the skill queue's length and target times; it reads no "
                                      "observation value, names no station, and never scores or fits",
    # point-archive infrastructure: names the private bucket, reads no buoy value
    "services/point_archive/__init__.py": "package docstring",
    "services/point_archive/core.py": "path and key constants of the archive; reads nothing",
    "services/point_archive/slim.py": "lossless row packing; reads nothing",
    "services/point_archive/storage.py": "bucket client; byte transport for the fenced readers and the collectors",
}


_FENCE_FNS = {"allow_url", "drop", "keep", "is_locked", "declare_collector"}


def _calls_fence(text):
    """True only for a real CALL of the fence (an ast Call node), so a mention in a comment, docstring or string does not
    satisfy the guard (LongCat review 2026-11-23)."""
    if not FENCE.search(text):
        return False
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        f = getattr(node, "func", None) if isinstance(node, ast.Call) else None
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            if (f.value.id == "buoy_holdout" and f.attr in _FENCE_FNS) or (f.value.id == "holdout" and f.attr == "state"):
                return True
    return False


def _modules():
    for p in sorted(BACKEND.rglob("*.py")):
        rel = p.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "venv/", ".venv/")) or "/node_modules/" in rel:
            continue
        yield rel, p.read_text(encoding="utf-8", errors="replace")


def test_every_buoy_truth_reader_routes_through_the_fence():
    unfenced = [rel for rel, text in _modules() if TOUCHES.search(text) and not _calls_fence(text) and rel not in EXEMPT]
    assert unfenced == [], ("these modules touch buoy truth but neither call services/buoy_holdout.py nor are reviewed in "
                            f"EXEMPT: {unfenced}")


def test_exemptions_are_live_and_hold_no_observation_url():
    texts = dict(_modules())
    for rel, why in EXEMPT.items():
        assert rel in texts, f"stale exemption {rel}"
        assert why.strip(), rel
        assert TOUCHES.search(texts[rel]), f"{rel} no longer touches buoy truth: drop its exemption"
        if rel not in ("services/buoy_holdout.py", "services/point_archive/qc.py"):
            assert not OBS_URL.search(texts[rel]), f"{rel} is exempt but holds a buoy-observation URL: fence it"


def test_no_workflow_fetches_buoy_truth_directly():
    for wf in sorted((REPO / ".github" / "workflows").glob("*.y*ml")):
        for n, line in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\b(curl|wget|Invoke-WebRequest)\b", line) and re.search(r"ndbc|cdip", line, re.I):
                raise AssertionError(f"{wf.name}:{n} fetches buoy truth outside the fenced backend: {line.strip()}")


def test_the_guard_catches_a_planted_reader():
    planted = 'URL = "https://www.ndbc.noaa.gov/data/realtime2/{}.txt"\n'
    assert TOUCHES.search(planted) and not FENCE.search(planted)
    assert _calls_fence(planted + "def f(u):\n    if not buoy_holdout.allow_url(u):\n        return None\n")
    # a mention in a comment or docstring is not a call
    assert not _calls_fence(planted + "# buoy_holdout.allow_url(u) is called elsewhere\n")
    assert not _calls_fence(planted + '"""uses buoy_holdout.drop(rows) upstream"""\n')


# ---------------------------------------------------------------- per call site (director follow-up, 2026-11-23)
# A module that calls the fence once can still hold a SECOND fetch that does not. So every expression that BUILDS a
# station-specific observation URL (an f-string, concatenation or .format() naming a per-station observation path) must sit
# in a function that itself calls the fence, unless the module is a declared collector or EXEMPT, or the function is
# reviewed below with its reason. Network-wide files (latest_obs.txt, activestations.xml) are not station-specific: they are
# dropped at load by their callers and are covered by the module-level test above.
STATION_OBS = re.compile(r"realtime2/|data/historical/|data/stdmet/|view_text_file|download_data|data/5day2|data/derived2"
                         r"|cdip/(?:realtime|archive)/|station_page\.php|cwwcNDBC")
CALLSITE_REVIEWED = {
    "scripts/grade_wind_lane_ndbc.py::anemometer_m": "station METADATA (anemometer height from station_page.php), not an "
                                                     "observation; a LOCKED buoy keeps its metadata",
    "scripts/wind_lr_obs.py::anemometer_m": "station METADATA for the wind-lr2 freeze; must stay unfenced or a freeze drops "
                                            "LOCKED buoys for lack of a height (wind-long-range-v2 amendment L1, Freeze order)",
    "scripts/served_wave_verify_probe_buoys.py::probe": "fetches only through urllib_opener, which refuses a LOCKED URL",
    "scripts/wind_lr2_truth.py::save_snapshot": "COLLECTION: archives every station's realtime2 verbatim (LOCKED buoys are "
                                                "still collected, #1199 section 1a); the snapshot reader drops LOCKED ids",
    "services/weather_pipeline/nearshore_lite/truth.py::realtime_url": "URL builder only; its one fetch path, fetch_realtime, "
                                                                        "calls allow_url",
}


def _function_fences(fn):
    for n in ast.walk(fn):
        f = getattr(n, "func", None) if isinstance(n, ast.Call) else None
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            if (f.value.id == "buoy_holdout" and f.attr in _FENCE_FNS) or                     (f.value.id == "holdout" and f.attr in ("state", "is_locked_path")):
                return True
    return False


def _station_url_builders(text):
    """Names of the innermost functions that build a station-specific observation URL without calling the fence."""
    tree, out = ast.parse(text), []
    fns = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for fn in fns:
        inner = [c for c in ast.walk(fn) if c is not fn and isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for n in ast.walk(fn):
            dynamic = (isinstance(n, ast.JoinedStr) and any(isinstance(v, ast.FormattedValue) for v in n.values))                 or isinstance(n, ast.BinOp)                 or (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "format")
            if not dynamic or any(c.lineno <= n.lineno <= c.end_lineno for c in inner):
                continue
            if STATION_OBS.search(ast.get_source_segment(text, n) or "") and not _function_fences(fn):
                out.append(fn.name)
                break
    return out


def _unfenced_call_sites():
    found = []
    for rel, text in _modules():
        if rel in EXEMPT or not TOUCHES.search(text) or "declare_collector(" in text:
            continue
        found += [f"{rel}::{name}" for name in _station_url_builders(text)]
    return found


def test_every_station_url_builder_sits_behind_the_fence():
    found = _unfenced_call_sites()
    unreviewed = sorted(set(found) - set(CALLSITE_REVIEWED))
    assert unreviewed == [], ("these functions build a per-station buoy-observation URL but do not call the fence "
                              f"(buoy_holdout.allow_url / keep / is_locked / drop) themselves: {unreviewed}")
    stale = sorted(set(CALLSITE_REVIEWED) - set(found))
    assert stale == [], f"stale call-site reviews (the function changed or is fenced now): {stale}"
    assert all(why.strip() for why in CALLSITE_REVIEWED.values())


def test_the_call_site_guard_catches_a_second_unfenced_fetch_in_a_fenced_module():
    planted = chr(10).join([
        "URL = 'https://www.ndbc.noaa.gov/data/realtime2/{}.txt'",
        "def fenced(s, sid):",
        "    if not buoy_holdout.allow_url(URL.format(sid)):",
        "        return None",
        "    return s.get(URL.format(sid))",
        "def second(s, sid):",
        "    return s.get(f'https://www.ndbc.noaa.gov/data/realtime2/{sid}.txt')",
        ""])
    assert _calls_fence(planted)                            # the module-level test is satisfied by `fenced` ...
    assert _station_url_builders(planted) == ["second"]     # ... the call-site test is not
