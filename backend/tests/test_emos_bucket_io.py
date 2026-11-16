"""The EMOS storage-only helper (scripts/emos_bucket_io.py): stdlib only (it runs as `python3 -I -S`), create-only
uploads, and no exception text in its output (advisor condition on #951)."""
import ast
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import emos_bucket_io as B  # noqa: E402

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "emos_bucket_io.py")


def test_imports_are_standard_library_only():
    tree = ast.parse(open(SRC, encoding="utf-8").read())
    mods = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            mods |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            mods.add((n.module or "").split(".")[0])
    assert mods <= {"json", "os", "sys", "urllib"}, mods


def test_upload_is_create_only_and_sends_only_new_files(tmp_path, monkeypatch):
    calls = []

    def fake_req(method, path, body=None, ctype=None, extra=None):
        calls.append((method, path, extra))
        return 200, b""
    monkeypatch.setattr(B, "_req", fake_req)
    runs = tmp_path / "runs"
    runs.mkdir()
    (runs / "2025060100.npz.new").write_bytes(b"x")
    (runs / "2025060200.npz").write_bytes(b"old")          # already stored: not re-sent
    (tmp_path / "emos_stations.json.new").write_text("{}")
    assert B.main(["x", "upload", "--dir", str(tmp_path)]) == 0
    paths = [c[1] for c in calls]
    assert paths == ["/storage/v1/object/weather-products/calibration/emos/stations.json",
                     "/storage/v1/object/weather-products/calibration/emos/runs/2025060100.npz"]
    assert all(c[2] == {"x-upsert": "false"} for c in calls)


def test_fetch_writes_stations_and_existing_list(tmp_path, monkeypatch):
    def fake_req(method, path, body=None, ctype=None, extra=None):
        if path.endswith("/stations.json"):
            return 200, b'{"ndbc": [], "asos": []}'
        if "/object/list/" in path:
            return 200, json.dumps([{"name": "2025060100.npz"}]).encode()
        return 404, b""
    monkeypatch.setattr(B, "_req", fake_req)
    assert B.main(["x", "fetch", "--dir", str(tmp_path)]) == 0
    assert json.load(open(tmp_path / "existing_runs.json")) == ["2025060100.npz"]
    assert (tmp_path / "emos_stations.json").exists()


def test_failures_print_class_not_text(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")

    def boom(*a, **k):
        raise OSError("secret-host.example.co said no")
    monkeypatch.setattr(B.urllib.request, "urlopen", boom)
    assert B._req("GET", "/x") == (0, b"")
    out = capsys.readouterr().out
    assert "OSError" in out and "secret-host" not in out
