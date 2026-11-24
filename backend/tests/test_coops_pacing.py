"""tide-a-harcon-v1 amendment 2 (PRE-DATA; v1-1 = NO RUN, an infra 403): every CO-OPS request is paced and bounded, and
a request that cannot be completed is a HARNESS failure: recorded, never swallowed into data, and VOID in the scorer.

Pins: the spacing; exponential backoff with jitter honouring Retry-After, bounded at BUDGET_S; 400/404 as harness
failures at once; a truncated or non-JSON body as infrastructure; a 200 error-JSON as data; other hosts untouched; the
failure escaping the REAL tide_fes.sources.get_json and the VERBATIM finder_check; the per-station finder runner
recording a failure and writing its output; the scorer's harness VOID; and the module's bytes."""
import hashlib
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
import paced_finder as PF  # noqa: E402
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
    """A scripted opener under the guard, a fake clock (sleeps advance it) and a log in tmp."""
    script, calls, sleeps, t = [], [], [], [1000.0]

    def orig(url, data=None, timeout=60, *a, **k):
        calls.append(url.full_url if hasattr(url, "full_url") else url)
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
    yield {"script": script, "calls": calls, "sleeps": sleeps, "t": t}
    CP.uninstall()


def test_requests_are_spaced_by_at_least_min_gap_retries_included(fake):
    for _ in range(3):
        urllib.request.urlopen(COOPS)
    assert [round(s, 6) for s in fake["sleeps"]] == [2.0, 2.0]          # immediate requests are held 2 s apart


def test_403_backs_off_exponentially_then_succeeds(fake):
    fake["script"] += [_http(403), _http(429), _R(b'{"predictions": [1]}')]
    r = urllib.request.urlopen(COOPS)
    assert json.loads(r.read()) == {"predictions": [1]}
    assert CP.BASE_S in fake["sleeps"] and 2 * CP.BASE_S in fake["sleeps"]


def test_retry_after_is_honoured(fake):
    fake["script"] += [_http(429, retry_after=300), _R(b"{}")]
    urllib.request.urlopen(COOPS)
    assert 300.0 in fake["sleeps"]


def test_backoff_is_bounded_then_a_harness_failure(fake):
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.HarnessFailure):
        urllib.request.urlopen(COOPS)
    assert fake["t"][0] - 1000.0 <= CP.BUDGET_S + 10 and len(fake["calls"]) < 12


def test_a_400_is_a_harness_failure_at_once_never_data(fake):
    fake["script"] += [_http(400)]
    with pytest.raises(CP.HarnessFailure):
        urllib.request.urlopen(COOPS)
    assert len(fake["calls"]) == 1


def test_a_truncated_body_is_infrastructure_and_a_200_error_json_is_data(fake):
    fake["script"] += [_R(b'{"predictions": [{"t": "2026'), _R(b'{"error": {"message": "No Predictions data was found."}}')]
    r = urllib.request.urlopen(COOPS)
    assert json.loads(r.read())["error"]["message"].startswith("No Predictions") and len(fake["calls"]) == 2


def test_other_hosts_pass_through_unpaced(fake):
    for _ in range(3):
        urllib.request.urlopen("https://example.com/x")
    assert fake["sleeps"] == []


def test_the_failure_escapes_the_real_get_json_never_no_constants(fake):
    import sources
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.HarnessFailure):
        sources.coops_harcon("9452421")


def test_the_failure_escapes_the_verbatim_finder_check(fake):
    import finder_check as FC
    from datetime import datetime, timezone
    fake["script"] += [_http(403)] * 50
    with pytest.raises(CP.HarnessFailure):
        FC.predictions("9452421", datetime(2027, 2, 1, tzinfo=timezone.utc), datetime(2027, 2, 2, tzinfo=timezone.utc), "h")


def test_the_paced_finder_records_a_failure_and_still_writes_its_output(tmp_path, monkeypatch):
    monkeypatch.setattr(CP, "install", lambda: None)
    st = tmp_path / "st.json"
    st.write_text(json.dumps({"strata": {"HARBOR_BAY": {"deciding": ["A", "B"], "reserve": []}}}), encoding="utf-8")

    def runner(argv):
        sid = json.loads(open(argv[argv.index("--stations") + 1], encoding="utf-8").read())["strata"]["HARBOR_BAY"]["deciding"][0]
        if sid == "B":
            raise CP.HarnessFailure("CO-OPS unavailable for B")
        out = argv[argv.index("--json") + 1]
        open(out, "w", encoding="utf-8").write(json.dumps({"gauges": {sid: {"hourly": {"median_abs_h_m": 0.001}}}}))
    out = tmp_path / "finder.json"
    PF.main(["--start", "2027-02-01", "--days", "14", "--stations", str(st), "--json", str(out)], runner=runner)
    merged = json.loads(out.read_text(encoding="utf-8"))
    assert list(merged["gauges"]) == ["A"] and merged["harness_failures"][0]["station"] == "B" and merged["paced"]


def test_the_scorer_voids_a_harness_failure_and_an_incomplete_run():
    sys.path.insert(0, HERE)
    import test_a_harcon_instrument as A
    for run in (dict(A.run(), harness_failures=[{"station": "H3", "why": "x"}]), dict(A.run(), complete=False)):
        r = S.score(run, A.finder(), A.held())
        assert r["verdict"] == "VOID" and not r["controls"]["harness"]["pass"] and "strata" not in r
    fin = A.finder()
    del fin["gauges"]["H3"]                                   # a missing finder row at a scored station: C1 VOID
    assert S.score(A.run(), fin, A.held())["verdict"] == "VOID"


def test_the_workflow_runs_both_coops_steps_paced_and_uploads_the_request_log():
    wf = open(os.path.join(HERE, "..", "..", ".github", "workflows", "tide-a-harcon.yml"), encoding="utf-8").read()
    assert "paced_finder.py --start 2027-02-01 --days 14 --stations" in wf
    assert "paced_run.py backend/scripts/tide_datum/a_harcon_parity.py" in wf and "coops_requests.jsonl" in wf
    assert "tide_datum/finder_check.py --start" not in wf                    # never the unpaced finder


def test_the_pacing_constants_are_fixed():
    assert (CP.MIN_GAP_S, CP.BASE_S, CP.CAP_S, CP.BUDGET_S) == (2.0, 15.0, 120.0, 600.0)
    assert CP.RETRY_STATUS == {403, 429, 500, 502, 503, 504} and issubclass(CP.HarnessFailure, BaseException)
    assert not issubclass(CP.HarnessFailure, Exception)
    src = open(CP.__file__, "rb").read().replace(b"\r\n", b"\n")
    assert b"os.environ" not in src                                           # no override
    assert hashlib.sha256(src).hexdigest() == PIN


PIN = "2af2c60058115c499fc631387c09f6c5fea0e52c9d47a32a3f52d1b056a60d64"
