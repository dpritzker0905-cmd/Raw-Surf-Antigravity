"""The index GC must actually reclaim — proven on a store with real garbage in it.

`scripts/trevec_index_gc.py` is the retention policy trevec does not ship. On 2026-07-29 the
absence of one let `.trevec/lance` reach 437 GB indexing a 0.46 GB repo (52,023 index versions,
one live) and fill a 936 GB volume to zero twice in a day.

⚠️ Running the GC against a HEALTHY store proves nothing: a freshly rebuilt index has 2 versions
and nothing is eligible, so the command exits clean whether or not it works. These tests build a
dataset that genuinely has superseded versions and assert the bytes come back — the same reason the
audit-tool guard was checked against the pre-fix script rather than only the fixed one.
"""
import os
import subprocess
import sys

import pytest

pa = pytest.importorskip("pyarrow", reason="pylance/pyarrow not installed")
lance = pytest.importorskip("lance", reason="pylance not installed")

SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "scripts", "trevec_index_gc.py",
)


def _make_store(root, versions=6, rows=256):
    """A .trevec/lance store whose dataset has `versions` versions, all but the last superseded."""
    store = os.path.join(root, ".trevec", "lance")
    os.makedirs(store, exist_ok=True)
    path = os.path.join(store, "code_nodes.lance")
    for i in range(versions):
        table = pa.table({"id": list(range(rows)), "vec": [float(i)] * rows})
        # `overwrite` leaves the previous version's files in place — exactly what trevec's
        # re-indexing does, and the reason the store grows without bound.
        lance.write_dataset(table, path, mode="create" if i == 0 else "overwrite")
    return path


def _run(root, *args, env=None):
    # stdin=DEVNULL is load-bearing on Windows: with pytest's capture in place the inherited stdin
    # is not a duplicable handle, and subprocess dies with `OSError [WinError 50]` before the child
    # ever starts — a failure that looks like the script is broken when nothing has run yet.
    return subprocess.run(
        [sys.executable, SCRIPT, "--path", root, *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        stdin=subprocess.DEVNULL, env=env, timeout=300,
    )


def test_dry_run_reports_but_changes_nothing(tmp_path):
    path = _make_store(str(tmp_path))
    before = len(lance.dataset(path).versions())
    assert before >= 6, "fixture did not create superseded versions"

    proc = _run(str(tmp_path), "--older-than", "0s", "--retain", "1")

    assert proc.returncode == 0, proc.stderr
    assert "DRY RUN" in proc.stdout
    assert len(lance.dataset(path).versions()) == before, "dry run mutated the dataset"


def test_apply_actually_reclaims(tmp_path):
    path = _make_store(str(tmp_path))
    before_versions = len(lance.dataset(path).versions())

    proc = _run(str(tmp_path), "--apply", "--older-than", "0s", "--retain", "1")

    assert proc.returncode == 0, proc.stderr
    after_versions = len(lance.dataset(path).versions())
    assert after_versions < before_versions, (
        f"GC removed nothing: {before_versions} -> {after_versions}\n{proc.stdout}"
    )
    # The live version must survive — a GC that reclaims everything is not a GC.
    assert after_versions >= 1
    assert lance.dataset(path).to_table().num_rows > 0, "dataset unreadable after GC"


def test_retain_is_honoured(tmp_path):
    """`--retain N` is the floor. Without it a mistaken `--older-than` could strip history."""
    path = _make_store(str(tmp_path), versions=8)

    _run(str(tmp_path), "--apply", "--older-than", "0s", "--retain", "4")

    assert len(lance.dataset(path).versions()) >= 4


def test_missing_store_is_not_an_error(tmp_path):
    """A repo with no index yet must not fail a CI step or a scheduled run."""
    proc = _run(str(tmp_path))
    assert proc.returncode == 0
    assert "nothing to prune" in proc.stdout


@pytest.mark.parametrize("console", ["cp1252", "ascii"])
def test_output_survives_a_narrow_console(tmp_path, console):
    """Same defect that killed the science audit at its second row: a Windows console hands Python
    a cp1252 stdout and any non-ASCII in the report aborts the run mid-way."""
    _make_store(str(tmp_path), versions=3)
    proc = _run(str(tmp_path), env=dict(os.environ, PYTHONIOENCODING=console))
    assert "UnicodeEncodeError" not in proc.stderr, proc.stderr[-1500:]
    assert "Traceback" not in proc.stderr, proc.stderr[-1500:]
    assert "free space:" in proc.stdout, "report did not reach its last line"
