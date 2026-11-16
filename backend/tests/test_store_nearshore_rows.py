"""The private store for the nearshore validation's full rows (scripts/store_nearshore_rows.py).

The full rows are our served forecasts at named stations and hours. These pin that they go ONLY to private Storage:
never to the public artifact, never to a log line; that the grading step never holds a Storage credential; that the
write is create-only, to one host; and that nothing here can fail the validation job."""
import inspect
import io
import json
import os
import urllib.error

import pytest

from scripts import run_nearshore_validation as R
from scripts import store_nearshore_rows as S
from services.weather_pipeline.nearshore_validation import (
    PRIVATE_ROW_KEYS, PRIVATE_ROWS_PREFIX, factor_rows, private_rows, private_rows_key)

WORKFLOW = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "nearshore-validation.yml")
ENV = {"SUPABASE_URL": "https://project.example", "SUPABASE_SERVICE_ROLE_KEY": "not-a-real-key"}
GEN = "2026-11-17T09:21:33.123456+00:00"


def _matched(**over):
    row = {"station": "143p1", "spot": "A", "valid_time": "2026-11-17T06:00:00Z", "offshore_hs_m": 1.5, "tp_s": 9.0,
           "swell_from_deg": 280.0, "model_hs_m": 1.05, "obs_hs_m": 1.6, "obs_time": "2026-11-17T06:10:00Z",
           "factors": {"friction": 1.0, "shoaling": 0.94, "exposure": 0.85, "kr": 0.873, "total": 0.6975},
           "upstream_provider": "x", "model_hs_legacy_friction_m": 0.9, "n_trains": 2}
    row.update(over)
    return row


def _file(tmp_path, rows=None, generated_at=GEN):
    p = tmp_path / "rows.json"
    p.write_text(json.dumps({"version": 1, "generated_at": generated_at,
                             "rows": private_rows([_matched()]) if rows is None else rows}), encoding="utf-8")
    return str(p)


class Opener:
    def __init__(self, status=200, error=None):
        self.status, self.error, self.requests = status, error, []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        if self.error:
            raise self.error
        resp = io.BytesIO(b"{}")
        resp.status = self.status
        return resp


def test_private_rows_keep_the_hour_and_the_heights_and_only_whitelisted_keys():
    rows = private_rows([_matched(station="b"), _matched(station="a"), _matched(factors=None)])
    assert [r["station"] for r in rows] == ["a", "b"] and set(rows[0]) == set(PRIVATE_ROW_KEYS) | {"factors"}
    assert rows[0]["valid_time"] == "2026-11-17T06:00:00Z" and rows[0]["model_hs_m"] == 1.05 and rows[0]["tp_s"] == 9.0
    assert "upstream_provider" not in rows[0] and "model_hs_legacy_friction_m" not in rows[0]
    # the public form of the same reading carries none of it
    public = repr(factor_rows([_matched()]))
    assert "06:00" not in public and "model_hs_m" not in public and "tp_s" not in public


def test_the_key_is_one_object_per_run_under_its_day():
    assert private_rows_key(GEN) == PRIVATE_ROWS_PREFIX + "2026-11-17/20261117092133.json"
    assert PRIVATE_ROWS_PREFIX == "calibration/nearshore/rows/"            # a namespaced key, beside the scored ledger
    for bad in (None, "", "yesterday", "2026-11-17"):
        with pytest.raises(ValueError):
            private_rows_key(bad)


def test_a_configured_run_posts_once_create_only_to_the_storage_host(tmp_path):
    op = Opener()
    line = S.store(_file(tmp_path), env=ENV, opener=op)
    assert line == "PRIVATE_ROWS status=stored n=1 key=calibration/nearshore/rows/2026-11-17/20261117092133.json"
    (req,) = op.requests
    assert req.get_method() == "POST" and req.host == "project.example"
    assert req.full_url == "https://project.example/storage/v1/object/weather-products/calibration/nearshore/rows/2026-11-17/20261117092133.json"
    assert req.get_header("X-upsert") == "false"                            # never overwrites an earlier run
    assert json.loads(req.data)["rows"][0]["model_hs_m"] == 1.05


def test_the_status_line_never_carries_the_url_the_key_or_a_row(tmp_path):
    for op in (Opener(), Opener(error=urllib.error.HTTPError("u", 409, "exists", {}, None)), Opener(error=TimeoutError("x"))):
        line = S.store(_file(tmp_path), env=ENV, opener=op)
        assert "project.example" not in line and "not-a-real-key" not in line and "1.05" not in line and "143p1" not in line
        assert line.startswith("PRIVATE_ROWS status=")


def test_nothing_here_raises_or_fails_the_job(tmp_path, capsys):
    assert S.store(str(tmp_path / "missing.json"), env=ENV, opener=Opener()) == "PRIVATE_ROWS status=no_file"
    assert S.store(_file(tmp_path, rows=[]), env=ENV, opener=Opener()) == "PRIVATE_ROWS status=no_rows n=0"
    unconfigured = Opener()
    assert S.store(_file(tmp_path), env={}, opener=unconfigured) == "PRIVATE_ROWS status=not_configured n=1"
    assert S.store(_file(tmp_path), env={"SUPABASE_URL": ENV["SUPABASE_URL"]}, opener=unconfigured).endswith("not_configured n=1")
    insecure = dict(ENV, SUPABASE_URL="http://project.example")
    assert S.store(_file(tmp_path), env=insecure, opener=unconfigured) == "PRIVATE_ROWS status=bad_url n=1"
    assert unconfigured.requests == []                                       # nothing was sent in any of those
    assert S.store(_file(tmp_path, generated_at="x"), env=ENV, opener=unconfigured) == "PRIVATE_ROWS status=no_timestamp n=1"
    refused = S.store(_file(tmp_path), env=ENV, opener=Opener(error=urllib.error.HTTPError("u", 409, "exists", {}, None)))
    assert refused.startswith("PRIVATE_ROWS status=refused_409 n=1 key=")
    assert S.store(_file(tmp_path), env=ENV, opener=Opener(error=TimeoutError("x"))) == "PRIVATE_ROWS status=failed_TimeoutError n=1"
    assert S.store(_file(tmp_path), env=ENV, opener=Opener(status=500)).startswith("PRIVATE_ROWS status=refused_500")
    assert S.main([str(tmp_path / "missing.json")]) == 0 and "PRIVATE_ROWS status=no_file" in capsys.readouterr().out


def test_the_runner_writes_the_private_file_only_when_asked():
    src = inspect.getsource(R.main)
    assert '"--private-rows-json", default=""' in src and "if args.private_rows_json:" in src and "private_rows(matched)" in src


def test_the_workflow_keeps_the_key_out_of_the_grading_step_and_the_rows_out_of_the_artifact():
    text = open(WORKFLOW, encoding="utf-8").read()
    grade = text[text.index("- name: Run the nearshore outcome loop"):text.index("- name: Store the full rows privately")]
    store = text[text.index("- name: Store the full rows privately"):text.index("- name: Upload the report series")]
    upload = text[text.index("- name: Upload the report series"):]
    # the step that grades holds no Storage credential, so its behaviour cannot depend on one
    assert "SUPABASE" not in grade and "--private-rows-json nearshore_rows_private.json" in grade
    # the store step is the only place the credential names appear in this workflow, by NAME, from secrets
    assert text.count("SUPABASE_SERVICE_ROLE_KEY") == 2 and "secrets.SUPABASE_SERVICE_ROLE_KEY" in store
    assert "store_nearshore_rows.py nearshore_rows_private.json || true" in store and "rm -f nearshore_rows_private.json" in store
    assert "if: always()" in store
    # the artifact lists its files one by one and the private file is not among them
    assert "nearshore_rows_private" not in upload and "backend/nearshore_rows.json" in upload
    assert "backend/*" not in upload and "backend/\n" not in upload
