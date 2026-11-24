"""The MOP-lite tile fetcher: dry run by default, size cap, allow-listed https hosts only. No network."""
import json

import pytest

from scripts import nearshore_lite_fetch as nf


def _manifest(tmp_path, tiles):
    p = tmp_path / "m.json"
    p.write_text(json.dumps(tiles), encoding="utf-8")
    return str(p)


def _tile(**kw):
    t = {"id": "cudem_a", "source": "CUDEM", "url": "https://www.ngdc.noaa.gov/x/a.tif", "bytes": 5_000_000,
         "native_datum": "NAVD88", "license": "public domain (NOAA NCEI)"}
    t.update(kw)
    return t


def test_dry_run_prints_the_plan_and_downloads_nothing(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(nf, "fetch", lambda *a, **k: pytest.fail("must not download on a dry run"))
    assert nf.main(["--manifest", _manifest(tmp_path, [_tile()]), "--out", str(tmp_path / "o")]) == 0
    out = capsys.readouterr().out
    assert "TOTAL 5.0 MB" in out and "DRY RUN" in out


def test_a_manifest_over_the_cap_is_refused_before_any_download(tmp_path, monkeypatch):
    monkeypatch.setattr(nf, "fetch", lambda *a, **k: pytest.fail("must not download over the cap"))
    m = _manifest(tmp_path, [_tile(bytes=3_000_000_000)])
    assert nf.main(["--manifest", m, "--max-total-mb", "2000", "--go"]) == 1


@pytest.mark.parametrize("url", ["http://www.ngdc.noaa.gov/a.tif", "https://evil.example.com/a.tif", "ftp://www.gebco.net/a"])
def test_only_https_on_allow_listed_hosts(tmp_path, url):
    with pytest.raises(ValueError, match="allow-listed"):
        nf.load_manifest(_manifest(tmp_path, [_tile(url=url)]))


def test_a_tile_missing_its_datum_or_licence_is_refused(tmp_path):
    t = _tile()
    del t["native_datum"]
    with pytest.raises(ValueError, match="native_datum"):
        nf.load_manifest(_manifest(tmp_path, [t]))


def test_the_workflow_is_dispatch_only():
    import os
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    text = open(os.path.join(root, ".github", "workflows", "nearshore-lite-bathymetry.yml"), encoding="utf-8").read()
    on = text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert "workflow_dispatch:" in on and "schedule" not in on and "push:" not in on and "pull_request" not in on
