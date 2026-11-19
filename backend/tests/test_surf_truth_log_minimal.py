"""The append-only surf-truth logs hold minimal content, and their retention periods wait for counsel (T1 legal lane).

Legal research 2026-11-18 (research, not legal advice): the anchor and admin logs are append-only and outlive an
account erasure, so they hold REASON CODES, never an admin's free text about a named person, and `detail` carries no
user content. The retention periods are David's or counsel's to set: they stay None, and nothing invents a number.
Design: docs/weather-program/T1-LOG-RETENTION-DESIGN-2026-11-18.md.
"""
import re
from pathlib import Path

import pytest

from services import surf_truth_admin, surf_truth_log_retention as lr

SHARED_JS = Path(__file__).resolve().parents[2] / "frontend/src/components/admin/surf-truth/shared.js"


def _js_map(name: str) -> dict:
    block = re.search(r"export const " + name + r" = \{(.*?)\};", SHARED_JS.read_text(encoding="utf-8"), re.S)
    assert block, name
    return dict(re.findall(r"(\w+): '([^']*)'", block.group(1)))


@pytest.mark.parametrize("name", ["ANCHOR_REASONS", "AUDIT_FAIL_REASONS"])
def test_the_admin_screen_offers_exactly_the_servers_reason_codes(name):
    assert _js_map(name) == getattr(surf_truth_admin, name)


def test_codes_are_short_identifiers_not_sentences():
    for code in list(surf_truth_admin.ANCHOR_REASONS) + list(surf_truth_admin.AUDIT_FAIL_REASONS):
        assert re.fullmatch(r"[a-z][a-z_]{2,31}", code), code


class _DB:
    def __init__(self):
        self.rows = []

    def add(self, row):
        self.rows.append(row)


def test_the_log_refuses_free_text_and_unknown_detail_keys():
    db = _DB()
    with pytest.raises(ValueError, match="codes, not free text"):
        surf_truth_admin.log_action(db, "boss", "audit_verdict", "surf_observation", "o1",
                                    reason="photo of Ana's car at the beach")
    with pytest.raises(ValueError, match="detail keys not allowed"):
        surf_truth_admin.log_action(db, "boss", "anchor_status", "anchor", "p1", reason="reliable_record",
                                    detail={"to": "active", "note": "lives next to the pier"})
    assert db.rows == []
    surf_truth_admin.log_action(db, "boss", "anchor_status", "anchor", "p1", reason="reliable_record",
                                detail={"from": None, "to": "active", "self": False})
    surf_truth_admin.log_action(db, "boss", "export", "surf_truth_export", "run1", detail={"rows": 3, "object": "x"})
    assert [r.reason for r in db.rows] == ["reliable_record", None]


def test_retention_periods_wait_for_an_answer_and_none_is_invented():
    names = [n for n, _q in lr.awaiting()]
    assert names == list(lr.PERIODS)                 # every period is still open: David's or counsel's to set
    for name in lr.PERIODS:
        assert getattr(lr, name) is None, name
