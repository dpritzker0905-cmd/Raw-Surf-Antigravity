"""Date precision must not invent midnight or hide real chronology reversals."""
from pathlib import Path
import shutil

import pytest

from scripts import memory_audit as audit


@pytest.mark.parametrize('cells,ordered', [
    (['2026-10-04', '2026-10-04 22:09Z'], True),
    (['2026-10-04 22:09Z', '2026-10-04'], True),
    (['2026-10-04 22:09Z', '2026-10-04', '2026-10-04 22:14Z'], True),
    (['2026-10-04 22:09Z', '2026-10-04', '2026-10-04 21:14Z'], False),
    (['2026-10-04 22:09Z', '2026-10-03'], False),
    (['2026-10-05 01:09Z', '2026-10-04'], False),
    (['2026-10-04 22:09Z', '2026-10-04 22:08Z'], False),
    (['2026-12-31 23:09Z', '2027-01-01'], True),
    (['2026-10-04 24:00Z'], False),
    (['2026-02-30'], False),
])
def test_scoreboard_precision_retains_all_explicit_chronology_constraints(cells, ordered):
    assert audit.scoreboard_dates_ordered(cells) is ordered


@pytest.mark.parametrize('last,expected_fail', [('23:00', False), ('21:00', True)])
def test_actual_audit_docs_retains_date_only_row_without_hiding_later_reversal(tmp_path, last, expected_fail):
    source = Path(__file__).resolve().parents[2]/'docs/weather-program'
    for name in audit.REQUIRED_DOCS:
        shutil.copyfile(source/name, tmp_path/name)
    (tmp_path/'SCOREBOARD.md').write_text('\n'.join(
        f'| {stamp} | fixture | unchanged | actual audit | control | no served change |'
        for stamp in ['2026-10-04 22:00Z', '2026-10-04', f'2026-10-04 {last}Z']), encoding='utf-8')
    results = audit.audit_docs(str(tmp_path))
    failures = [message for level, message in results if level == 'FAIL']
    assert bool(failures) is expected_fail, failures
    if expected_fail:
        assert any('not in date order' in message for message in failures)
