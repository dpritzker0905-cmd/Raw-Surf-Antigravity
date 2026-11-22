"""Guards on the long-range wind v2 workflows: dispatch-only, read-only token, the owner's word required, no secret."""
import glob
import os

import pytest
import yaml

WF = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".github", "workflows")
FILES = sorted(glob.glob(os.path.join(WF, "wind-lr2-*.yml")))


def test_the_three_workflows_exist():
    assert [os.path.basename(f) for f in FILES] == ["wind-lr2-analyse.yml", "wind-lr2-collect.yml", "wind-lr2-snapshots.yml"]


@pytest.mark.parametrize("path", FILES)
def test_dispatch_only_read_only_and_owner_word_required(path):
    text = open(path, encoding="utf-8").read()
    doc = yaml.safe_load(text)
    on = doc.get(True, doc.get("on"))                                  # PyYAML reads the bare key `on` as True
    assert list(on) == ["workflow_dispatch"], "no schedule, push or pull_request trigger: every run needs the owner's word"
    assert on["workflow_dispatch"]["inputs"]["owner_word_ref"]["required"] is True
    assert "test -n" in text and "owner_word_ref" in text
    perms = doc["permissions"]
    assert perms["contents"] == "read" and not any(v == "write" for v in perms.values())
    assert "secrets." not in text and "SERVICE_ROLE" not in text and "CDS_API_KEY" not in text


def test_a_test_collection_needs_the_committed_freeze_manifest():
    text = open(os.path.join(WF, "wind-lr2-collect.yml"), encoding="utf-8").read()
    assert 'freeze-manifest.json' in text and '"test"' in text
    assert "max-parallel: 3" in text
