"""Local credential transport never places payloads on OS command lines."""
import json
from pathlib import Path
import secrets
import subprocess
import sys

import pytest

from scripts.local_copernicus_auth import install_private_copernicus_transport
from scripts import copernicus_stdin_entry


@pytest.mark.parametrize("fetcher", ["copernicus_global_fetcher.py", "copernicus_fetcher.py"])
def test_payload_transported_privately_and_options_preserved(monkeypatch, fetcher):
    calls = []

    def original(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, "ok", "")

    monkeypatch.setattr(subprocess, "run", original)
    install_private_copernicus_transport()
    once = subprocess.run
    install_private_copernicus_transport()
    assert subprocess.run is once
    value = secrets.token_urlsafe(24)
    payload = json.dumps({"password": value, "bbox": [0, 0, 1, 1]})
    result = subprocess.run([sys.executable, "-OO", "services/" + fetcher, payload],
                            capture_output=True, text=True, timeout=25)
    args, options = calls[0]
    assert value not in " ".join(args) and payload not in args
    assert Path(args[2]).name == "copernicus_stdin_entry.py"
    assert args[3] == "services/" + fetcher
    assert options == {"capture_output": True, "text": True, "timeout": 25, "input": payload}
    assert result.returncode == 0


def test_other_providers_unchanged(monkeypatch):
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kwargs: calls.append((args, kwargs)))
    install_private_copernicus_transport()
    args = [sys.executable, "-OO", "services/noaa_gfs_wave_fetcher.py", "{}"]
    subprocess.run(args, timeout=99)
    assert calls == [(args, {"timeout": 99})]


def test_timeout_does_not_include_private_payload(monkeypatch):
    def timeout(args, **kwargs):
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    monkeypatch.setattr(subprocess, "run", timeout)
    install_private_copernicus_transport()
    value = secrets.token_urlsafe(24)
    with pytest.raises(subprocess.TimeoutExpired) as exc:
        subprocess.run([sys.executable, "-OO", "services/copernicus_fetcher.py",
                        json.dumps({"password": value})], timeout=1)
    assert value not in str(exc.value)


def test_entry_rejects_unexpected_target(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", ["entry", str(tmp_path / "copernicus_fetcher.py")])
    with pytest.raises(RuntimeError, match="Unexpected Marine fetcher"):
        copernicus_stdin_entry.main()
