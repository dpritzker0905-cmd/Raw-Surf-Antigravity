"""tide-a-harcon-v1 amendment 3 (PRE-DATA; v1-1 = NO RUN, an infra 403; the advisor-approved pacing design v2 with R1
and R2): every CO-OPS request is paced, verified, classified and bounded; a request that cannot be completed ABORTS the
step with outcome.json "no_run_infra" (R2), never a FAIL, VOID or replacement; and nothing outcome-bearing is printed
before the score (R1 (b)).

Pins: spacing (startup gap, retries included); backoff with jitter and Retry-After; the per-request and step budgets;
400/404 at once; a truncated or non-JSON body as infrastructure, a 200 error-JSON or empty constants as data; other hosts
refused by the http guard; the request audit; the abort escaping the REAL tide_fes.sources.get_json and the VERBATIM
finder_check; the runner's outcome.json and exit 3; R1 (b) on the instrument's prints; the scorer refusing an
incomplete run; the workflow; the fixed constants and the module's bytes."""
import ast
import hashlib
import http.client
import io
import json
import os
import sys
import urllib.error
import urllib.request

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(HERE, "..", "scripts", "tide_datum")
sys.path.insert(0, TD)
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_fes"))
import coops_pacing as CP  # noqa: E402
import paced_run as PR  # noqa: E402
import a_harcon_score as S  # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=9452421&format=json"


class _R:
    def __init__(self, body, status=200):
        self._b, self.status, self.headers = io.BytesIO(body), status, {}

    def read(self, *a):
        return self._b.read(*a)

    def __enter__(self):
        return self

    def __exit__(self, *e):
        return False


def _http(code, retry_after=None):
    hdrs = {"Retry-After": str(retry_after)} if retry_after is not None else {}
    return urllib.error.HTTPError(COOPS, code, "x", hdrs, io.BytesIO(b"{}"))


@pytest.fixture
def fake(monkeypatch, tmp_path):
    """A scripted opener under the guard (it bumps the http-layer count as a real request would), a fake clock whose
    sleeps advance it, and a log in tmp."""
    script, calls, sleeps, t = [], [], [], [1000.0]

    def orig(url, data=None, timeout=60, *a, **k):
        calls.append(url.full_url if hasattr(url, "full_url") else url)
        CP._state["http_count"] += 1
        nxt = script.pop(0) if script else _R(b'{"predictions": []}')
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt

    def sleep(s):
        sleeps.append(s)
        t[0] += s
    CP.uninstall()
    monkeypatch.setattr(urllib.request, "urlopen", orig)
    monkeypatch.setattr(CP, "_clock", {"now": lambda: t[0], "sleep": sleep, "rand": lambda: 0.0})
    monkeypatch.setattr(CP, "LOG_PATH", str(tmp_path / "log.jsonl"))
    CP.install()
    yield {"script": script, "calls": calls, "sleeps": sleeps, "t": t, "log": tmp_path / "log.jsonl"}
    CP.uninstall()


def test_requests_are_spaced_with_a_startup_gap(fake):
    for _ in range(3):
        urllib.request.urlopen(COOPS)
    assert [round(s, 6) for s in fake["sleeps"]] == [2.0, 2.0, 2.0]       # startup gap, then 2 s apart
    CP.audit()                                                            # every request went through the wrapper


def test_403_and_429_back_off_exponentially_then_succeed(fake):
    fake["script"] += [_http(403), _http(429), _R(b'{"predictions": [1]}')]
    assert json.loads(urllib.request.urlopen(COOPS).read()) == {"predictions": [1]}
    assert CP.BASE_S in fake["sleeps"] and 2 * CP.BASE_S in fake["sleeps"]


def test_retry_after_is_honoured_and_an_excessive_one_aborts(fake):
    fake["script"] += [_http(429, retry_after=300), _R(b"{}")]
    urllib.request.urlopen(COOPS)
    assert 300.0 in fake["sleeps"]
    fake["script"] += [_http(429, retry_after=5000)]
    with pytest.raises(CP.CoopsUnavailable):
        urllib.request.urlopen(COOPS)


def test_the_per_request_budget_bounds_the_backoff(fake):
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.CoopsUnavailable) as e:
        urllib.request.urlopen(COOPS)
    assert fake["t"][0] - 1000.0 <= CP.BUDGET_S + 10 and e.value.station == "9452421" and e.value.attempts > 1


def test_the_step_budget_aborts_before_a_wait_it_cannot_cover(fake):
    CP.set_budget(20.0)
    fake["script"] += [_http(403), _http(403)]
    with pytest.raises(CP.CoopsUnavailable):
        urllib.request.urlopen(COOPS)
    assert len(fake["calls"]) == 2                                        # 15 s fitted, 30 s did not


def test_a_400_or_404_aborts_at_once(fake):
    for code in (400, 404):
        fake["script"] += [_http(code)]
        with pytest.raises(CP.CoopsUnavailable):
            urllib.request.urlopen(COOPS)


def test_classification_truncated_is_infra_and_no_data_answers_are_data(fake):
    fake["script"] += [_R(b'{"predictions": [{"t": "2026'),
                       _R(b'{"error": {"message": "No Predictions data was found."}}'),
                       _R(b'{"units": "meters", "HarmonicConstituents": []}')]
    assert "error" in json.loads(urllib.request.urlopen(COOPS).read())   # retried once, then data
    assert json.loads(urllib.request.urlopen(COOPS).read())["HarmonicConstituents"] == []
    assert len(fake["calls"]) == 3


def test_the_http_guard_refuses_other_hosts_and_non_get():
    CP.uninstall()
    CP.install()
    try:
        for host, method in (("raw-surf-backend.onrender.com", "GET"), ("example.com", "GET"), (CP.HOST, "POST")):
            conn = http.client.HTTPSConnection(host)
            with pytest.raises(CP.CoopsUnavailable):
                conn.request(method, "/x")
    finally:
        CP.uninstall()


def test_the_audit_catches_a_request_that_bypassed_the_wrapper(fake):
    urllib.request.urlopen(COOPS)
    CP._state["http_count"] += 1                                         # a CO-OPS request outside the wrapper
    with pytest.raises(CP.CoopsUnavailable):
        CP.audit()


def test_the_abort_escapes_the_real_get_json_never_no_constants(fake):
    import sources
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.CoopsUnavailable):
        sources.coops_harcon("9452421")


def test_the_abort_escapes_the_verbatim_finder_check(fake):
    import finder_check as FC
    from datetime import datetime, timezone
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.CoopsUnavailable):
        FC.predictions("9452421", datetime(2027, 2, 1, tzinfo=timezone.utc), datetime(2027, 2, 2, tzinfo=timezone.utc), "h")


def test_r2_the_runner_writes_no_run_infra_and_exits_3(tmp_path, monkeypatch):
    target = tmp_path / "target.py"
    target.write_text("import coops_pacing as CP\nraise CP.CoopsUnavailable('blocked', '9452421', 6)\n", encoding="utf-8")
    monkeypatch.syspath_prepend(TD)
    out = tmp_path / "outcome.json"
    monkeypatch.setattr(CP, "install", lambda: None)
    with pytest.raises(SystemExit) as e:
        PR.main(["--budget-s", "100", "--outcome", str(out), str(target)])
    doc = json.loads(out.read_text(encoding="utf-8"))
    assert e.value.code == 3 and doc["status"] == "no_run_infra" and doc["station"] == "9452421" and doc["attempts"] == 6


def test_the_runner_passes_argv_and_runs_as_main(tmp_path, monkeypatch):
    target = tmp_path / "t.py"
    target.write_text("import sys, json\nif __name__ == '__main__':\n    json.dump(sys.argv, open(sys.argv[-1], 'w'))\n",
                      encoding="utf-8")
    monkeypatch.setattr(CP, "install", lambda: None)
    monkeypatch.setattr(CP, "audit", lambda: None)
    out = tmp_path / "argv.json"
    PR.main(["--budget-s", "100", str(target), "--start", "2027-02-01", str(out)])
    assert json.loads(out.read_text(encoding="utf-8")) == [str(target), "--start", "2027-02-01", str(out)]


def test_r1b_the_instrument_prints_nothing_outcome_bearing():
    """R1 (b): before a score exists, the only line the instrument prints is `sid stratum N donor(s)` (no arm, error,
    match row, identity or leg). Pinned on the source: exactly one print call, with exactly those arguments."""
    src = open(os.path.join(TD, "a_harcon_parity.py"), encoding="utf-8").read()
    prints = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "print"]
    assert len(prints) == 1
    args = [ast.unparse(x) for x in prints[0].args]
    assert args == ["sid", "stratum", "len(row['donors'])", "'donor(s)'"]
    assert "sys.stdout" not in src and "logging" not in src


def test_the_scorer_refuses_an_incomplete_run(tmp_path):
    sys.path.insert(0, HERE)
    import test_a_harcon_instrument as A
    run = A.run()
    run.pop("complete")
    p = {n: tmp_path / f"{n}.json" for n in ("run", "finder", "stations")}
    for n, d in (("run", run), ("finder", A.finder()), ("stations", A.held())):
        p[n].write_text(json.dumps(d), encoding="utf-8")
    out = tmp_path / "score.json"
    with pytest.raises(SystemExit):
        S.main(["--run", str(p["run"]), "--finder", str(p["finder"]), "--stations", str(p["stations"]), "--out", str(out)])
    assert not out.exists()


def test_the_workflow_runs_both_coops_steps_paced_with_an_outcome():
    wf = open(os.path.join(HERE, "..", "..", ".github", "workflows", "tide-a-harcon.yml"), encoding="utf-8").read()
    assert ("paced_run.py --budget-s 3300 --outcome outcome.json backend/scripts/tide_datum/finder_check.py "
            "--start 2027-02-01 --days 14 --stations") in wf
    assert "paced_run.py --budget-s 6900 --outcome outcome.json backend/scripts/tide_datum/a_harcon_parity.py" in wf
    assert "Outcome (R2; always)" in wf and "coops_requests.jsonl" in wf and "outcome.json" in wf
    assert "run: python backend/scripts/tide_datum/finder_check.py" not in wf          # never the unpaced finder


def test_the_pacing_constants_are_fixed_and_the_module_is_pinned():
    assert (CP.MIN_GAP_S, CP.BASE_S, CP.CAP_S, CP.BUDGET_S, CP.RETRY_AFTER_MAX_S) == (2.0, 15.0, 120.0, 600.0, 900.0)
    assert issubclass(CP.CoopsUnavailable, BaseException) and not issubclass(CP.CoopsUnavailable, Exception)
    src = open(CP.__file__, "rb").read().replace(b"\r\n", b"\n")
    assert b"os.environ" not in src
    assert hashlib.sha256(src).hexdigest() == PIN


PIN = "e1f68909290937028d40818d6f30b062396263502da5185c9d52a58ca0c1cfde"
