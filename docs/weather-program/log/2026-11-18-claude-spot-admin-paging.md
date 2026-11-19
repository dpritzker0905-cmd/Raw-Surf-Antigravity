# 2026-11-18 Claude: the admin spot tables page through every row (PR 2 of 4)

Session: surf-spot adviser lane (`466af216`). Branch `claude/spot-admin-paging`, stacked on
`claude/spot-candidates-holding-table` (#1065). Admin screens and admin-only routes. No served number moves. Nothing
was written to any database. No spot was added, moved or hidden.

## 2026-11-18 22:42Z What was done, and why

**Asked for by David**, typed in this session: "We should allow more spots on a table too in the admin, so we can
have pagination to see them all in the table better."

**Assigned by the director** as step 2 of 4: "server-side paging with true totals for Spots, the Precision Queue and
Candidates", shipped ON with a kill switch and tests (D-080).

**Before.** The Spots table asked `/admin/spots/list` for up to 5,000 rows, filtered them in the browser and showed
the first 50. The Precision Queue asked `/admin/spots/queue` with no page, got 20 rows, and its tab read
"Flagged (20)" while the queue held about 1,700. There was no candidates screen.

**After.**

- `GET /admin/spots/list`: the accuracy filter (`accuracy=flagged|low_accuracy|unverified|verified`) and the search
  (name, region, country) now run in the database; rows are ordered by name then id. `limit=5000` still works (the
  map editor uses it); `flagged_only` still works.
- `GET /admin/spots/queue`: page size up to 200, returns `limit`, and the order has a name and id tiebreak. The
  tiebreak is a fix, not a nicety: `created_at` is empty on most rows, so ordering by it alone let the database
  return a different order per page, and a spot could repeat or never appear.
- `GET /admin/spots/candidates` (new, admin only, read only): one page of the holding table, the count of every
  matching row, and the whole table's counts by status and by tier.
- Admin screens: a shared pager (`AdminPager.js`: range in words, rows per page 25/50/100/200, first / previous /
  next / last, every control named, range announced politely). The Spots table and the Precision Queue use it, and
  the Precision Queue gains a read-only "Candidates" tab over the holding table. The Spots country filter now lists
  every country in the database (from the tiles' read), not only the ones on the loaded page.
- **Kill switch:** `window.__RAW_DISABLE_ADMIN_SPOT_PAGING__ = true` before the admin console loads. The Spots table
  sends the old `limit=5000` request and shows the old first-50 view; the Precision Queue sends the old request with
  no page; the Candidates tab is hidden.

## Measured

- Backend, `tests/test_spot_admin_paging.py` (25 tests, guards lane), over real HTTP against the real routers on
  SQLite: walking the pages of each list at two page sizes visits every row exactly once in the same order (120
  spots with eight sharing one name; a queue where no row has `created_at`; 230 candidates); every filter returns
  the hand-counted total; `limit=5000` is accepted and 5001 refused; a bad filter is a 422; the candidates list
  refuses a caller who is not an admin.
- Frontend, `AdminSpotPaging.test.js` (14 tests, 1 suite): the request each table sends, the totals shown
  ("Showing 1-50 of 1,776 spots", "Flagged (1,702)", "Showing 1-50 of 23,732 candidates"), the pager's controls by
  accessible name, and, with the kill switch set, the old requests (`limit=5000`; the queue with no parameters), no
  pager and no Candidates tab.
- Local: backend 60 passed across the three spot-admin files; frontend suite run from a dot-free copy of `frontend/`
  (the known worktree limitation); `node scripts/check_eslint.js` clean; flake8 gate clean; file sizes under 800.

## Not verified, and not in this PR

- **Not looked at in a browser.** The admin console needs a signed-in admin and a running backend; the screens were
  exercised through the Jest tests only. The three themes rely on the theme tokens the neighbouring admin screens
  already use (`bg-muted`, `text-foreground`, `border-border`); no colour was hard-coded in the new files.
- `npm run build` not run locally; hosted CI is the authority for the build and the full suites.
- The map editor (`AdminSpotEditor`) still loads every spot in one request; it draws them on a map, and paging a
  map is a different change.
- No review, placement or promote action on a candidate. Those are steps 3 and 4.
