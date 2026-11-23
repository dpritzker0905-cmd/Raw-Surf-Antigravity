"""The CLIM_GUST public mirror (design c1) and the ordered, always-verified sources: the private bucket first, then the public release
asset named by its hash. Offline: fake HTTP, no release is created by any test."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import pytest
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_gust as G  # noqa: E402

UTC = timezone.utc
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EVID = os.path.join(ROOT, "docs", "weather-program", "evidence", "wind-long-range-v2")
WF = os.path.join(ROOT, ".github", "workflows", "wind-lr2-analyse.yml")


class R:
    def __init__(self, code, content=b""):
        self.status_code, self.content = code, content


def _table(tmp_path):
    clim = G.ClimGust.build({"S1": [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 25})
    body = json.dumps(clim.table(), sort_keys=True, separators=(",", ":")).encode()
    hsh = tmp_path / "h.sha256"
    hsh.write_text(hashlib.sha256(body).hexdigest() + "  t.json\n")
    return clim, body, str(hsh)


def test_the_first_source_that_can_be_read_and_verifies_wins_and_the_second_is_not_touched(tmp_path):
    clim, body, hsh = _table(tmp_path)
    calls = []
    srcs = [("bucket", lambda u, timeout: (calls.append(u), R(200, body))[1]), ("public", lambda u, timeout: (calls.append(u), R(200, body))[1])]
    got = G.fetch_and_load_sources(srcs, hsh, str(tmp_path / "d.json"))
    assert got.sha256() == clim.sha256() and calls == ["bucket"]


def test_an_unreadable_source_falls_through_to_the_next_and_that_one_is_verified_too(tmp_path):
    clim, body, hsh = _table(tmp_path)
    calls = []

    def down(u, timeout):
        calls.append(u)
        return R(503)

    def boom(u, timeout):
        calls.append(u)
        raise ConnectionError("detail that must not be echoed")
    for first in (down, boom):
        calls.clear()
        got = G.fetch_and_load_sources([("bucket", first), ("public", lambda u, timeout: (calls.append(u), R(200, body))[1])],
                                       hsh, str(tmp_path / "d.json"))
        assert got.sha256() == clim.sha256() and calls == ["bucket", "public"]


def test_a_source_that_is_read_but_does_not_match_refuses_at_once_and_is_never_routed_around(tmp_path):
    _clim, body, hsh = _table(tmp_path)
    calls = []
    srcs = [("bucket", lambda u, timeout: (calls.append(u), R(200, body + b" "))[1]), ("public", lambda u, timeout: (calls.append(u), R(200, body))[1])]
    with pytest.raises(G.ClimGustRefused, match="!= committed") as e:
        G.fetch_and_load_sources(srcs, hsh, str(tmp_path / "d.json"))
    assert not isinstance(e.value, G.ClimGustUnavailable) and calls == ["bucket"]       # the good public copy is NOT used to hide it


def test_a_bad_public_mirror_refuses_too(tmp_path):
    _clim, body, hsh = _table(tmp_path)
    srcs = [("bucket", lambda u, timeout: R(404)), ("public", lambda u, timeout: R(200, b"{}"))]
    with pytest.raises(G.ClimGustRefused, match="!= committed"):
        G.fetch_and_load_sources(srcs, hsh, str(tmp_path / "d.json"))                 # every source is verified, the mirror included


def test_no_source_readable_or_no_source_given_refuses(tmp_path):
    _clim, _body, hsh = _table(tmp_path)
    with pytest.raises(G.ClimGustRefused, match="no CLIM_GUST source could be read"):
        G.fetch_and_load_sources([("a", lambda u, timeout: R(500)), ("b", lambda u, timeout: R(404))], hsh, str(tmp_path / "d.json"))
    with pytest.raises(G.ClimGustRefused, match="no CLIM_GUST source given"):
        G.fetch_and_load_sources([], hsh, str(tmp_path / "d.json"))
    assert not (tmp_path / "d.json").exists()                                       # nothing left behind


def test_a_missing_hash_file_refuses_even_when_a_source_downloads(tmp_path):
    _clim, body, _hsh = _table(tmp_path)
    with pytest.raises(G.ClimGustRefused, match="unreadable"):
        G.fetch_and_load_sources([("a", lambda u, timeout: R(200, body))], str(tmp_path / "gone.sha256"), str(tmp_path / "d.json"))


def test_the_cli_tries_the_bucket_with_the_key_then_the_public_url_without_it(tmp_path, monkeypatch):
    import requests
    clim, body, hsh = _table(tmp_path)
    seen = []

    def fake_get(url, headers=None, timeout=None):
        seen.append((url, headers))
        return R(503) if "supabase" in url or "storage/v1" in url else R(200, body)
    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_testvalue")
    out = tmp_path / "o" / "t.json"
    rc = G.main(["fetch-table", "--object", "calibration/x/t.json", "--hash", hsh, "--out", str(out),
                 "--public-url", "https://github.example.invalid/releases/download/tag/t.json"])
    assert rc == 0 and out.read_bytes() == body
    assert seen[0][1] == {"apikey": "sb_secret_testvalue"} and seen[1][1] is None            # the public mirror never receives the key


# ------------------------------------------------------------------------------------------------ the record, the notes, the workflow
def _record():
    return json.load(open(os.path.join(EVID, "wind_lr2_clim_gust.release.json"), encoding="utf-8"))


def test_the_release_record_is_consistent_with_the_committed_hash():
    rec = _record()
    committed = open(os.path.join(EVID, "wind_lr2_clim_gust.json.sha256"), encoding="utf-8").read().split()[0]
    assert rec["sha256"] == committed == "1e7df526a8598fc10e476318645829e792f5abd7cf6bdc3862d964f9954d01d8"
    assert rec["asset"] == f"wind_lr2_clim_gust-{committed[:16]}.json" and rec["tag"] == f"wind-lr2-clim-gust-{committed[:16]}"
    assert rec["url"] == f"https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/releases/download/{rec['tag']}/{rec['asset']}"
    assert rec["source_run"] == 45266543788 and rec["bytes"] == 12810040
    assert "published_at" in rec                                              # None until the release exists, then a follow-up commit fills it


def test_the_release_notes_carry_attribution_the_full_hash_and_the_corrected_table_rule():
    rec = _record()
    notes = open(os.path.join(EVID, "clim-gust-release-notes.md"), encoding="utf-8").read()
    assert rec["sha256"] in notes and "NOAA" in notes and "National Data Buoy Center" in notes
    assert "NEW hash-named asset" in notes and "Nothing here is ever overwritten or deleted" in notes
    assert f"gh release create {rec['tag']} {rec['asset']}" in notes and "--latest=false" in notes
    assert "sha256sum clim_gust_dl/wind_lr2_clim_gust.json" in notes


def test_the_fetch_step_uses_exactly_the_recorded_public_url_and_the_score_job_refuses_loudly_without_the_artifact():
    rec = _record()
    text = open(WF, encoding="utf-8").read()
    doc = yaml.safe_load(text)
    fetch_run = [s["run"] for s in doc["jobs"]["fetch-clim-gust"]["steps"] if "fetch-table" in s.get("run", "")][0]
    assert f"--public-url {rec['url']}" in fetch_run
    assert "authorization" not in fetch_run.lower() and "secrets." not in fetch_run
    steps = doc["jobs"]["analyse"]["steps"]
    names = [s.get("name", "") for s in steps]
    assert names.index("Verified CLIM_GUST table (score only)") < names.index("Refuse loudly without the verified CLIM_GUST table (score only)") < names.index("Run the command")
    refuse = [s for s in steps if s.get("name", "").startswith("Refuse loudly")][0]
    assert "'score'" in refuse["if"] and "test -s" in refuse["run"] and "exit 1" in refuse["run"] and "${{" not in refuse["run"]
    assert "approval gate" in text                                            # the remaining barrier is documented where the key is used
