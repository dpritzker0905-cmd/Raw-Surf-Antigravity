# 2026-11-19 — T1 lane: the account-deletion stack (#1062, #1082)

Append-only. Lane T1 (crowd truth and privacy), started by the director session.

## #1062 SQLite census: why dev read 0 and #1062 read 12 (advisor question at 159129720)

- Fix: commit 159129720. The shared erasure fixture `maker` (tests/test_surf_truth_erasure.py) built an aiosqlite
  engine and never disposed it. It now disposes the engine at teardown.
- Why dev never saw it, measured: only the estate lane loads the census (`-p tests.sqlite_lifecycle_census` in
  ci.yml). `scripts/ci_test_lanes.py` puts test_surf_truth_erasure.py in guards (no census) and
  test_account_deletion_grace.py in estate. The leak was on dev all along, but no census lane ran the fixture until
  #1062's grace tests imported it into estate. All 12 sites in artifact sqlite-lifetime-44580273459-1 were grace tests.
  Under the census, the erasure file alone read 8 unclosed / 5 workers before the fix.
- Still unexplained: whether #1062's Session hooks hold a connection of their own. After the fix, grace + erasure +
  revocation + notification tests read 0 unclosed / 0 workers, which suggests not, but no separate control isolates it.

## #1082 estate failures after the dev merge (ed1ec47bc, run 44651993018)

- tests/test_audit_account_boundaries.py (6 cases): its private SQLite world lacked `account_deletions`, which the
  listing filter now reads. The fixture creates the table (assertions unchanged).
- tests/test_audit_locker_boundaries.py::test_public_preview_route...: the locker's public gallery called
  `assert_owner_listed` (a `db.get`) before its query, and the stub DB has no `get`. The route now puts
  `listed_clause(SurferGalleryItem.surfer_id)` in its one query instead: a withdrawn account's public locker returns
  an empty list (as for any account with nothing public) rather than a 404. The test now also asserts the exclusion is
  in that single query and that only one query runs.
- Limit: no behavioural test with a real pending-deletion row for the locker route. The clause is the same
  `listed_clause` covered by tests/test_deletion_hides_account.py.
