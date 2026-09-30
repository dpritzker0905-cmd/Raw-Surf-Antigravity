# 2026-09-30 session mojibake-debris: the ASCII debris da30f15d left in user-visible strings

Worktree `C:\Users\David\App\raw-surf-wt`, branch `claude/mojibake-debris-cleanup` from `origin/dev` at `0d8e587a`
(#204). Owner brief (chat): reproduce the census of `da30f15d`'s non-ASCII strip, check each line against the current
file, restore clean text (word or lucide icon, aria-hidden plus a text equivalent), a jest source guard plus focused
tests, a PR against dev, and later: "Make sure to do this best possible to prevent regressions." Times are clock reads
(`date -u`) or platform timestamps (L-P10).

**No served number changes** (no surf height, rating, glyph score, hub or sim value): no SCOREBOARD row. Frontend and
docs only; the merge restarts the Render backend (W-26).

## Census (method and numbers)
- `git show da30f15d -U0 -- frontend/src`, removed/added lines paired in order per hunk, comment lines skipped, the
  OLD bytes classified: invalid UTF-8 or U+FFFD / box-drawing / U+0393 / cp437-cp1252 letter runs = mojibake; emoji
  code points = emoji; a lone accented letter or dash/arrow = typography.
- 508 code lines: **361 mojibake-origin** (281 still present verbatim at `0d8e587a`, 80 changed since), 13 real emoji
  (5 still present), 134 typography (em dash / arrow, almost all comments and console text). The brief's first pass
  counted 357; the 4-line difference is lines whose old bytes were not valid UTF-8, which this pass counts as mojibake.
  Top files match the brief: CrewChat 22 (now mostly `messages/crewChatUtils.js` + `hooks/useCrewChat.js`),
  StokedTab 14, LineupNotifications 14, HairFilterEngine 14, CrewLeaderboard 13, GalleryModals 12.
- The old lines were already two layers deep: U+2261 had been transliterated to `=`, U+0393 to `G`, box-drawing to
  `+`/`-`, so the strip left `=ƒôì` -> `=`, `GÇó` -> `G`, `┬╖` -> `-+`. Originals were recovered by reversing the
  cp437 layer, and for data values from each file's first commit (clean UTF-8 there).
- Current-tree check: a babel AST walk of every string literal, template chunk and JSX text in 815 files found 410
  candidate hits; after the fixes 37 remained, all legitimate (`'='.repeat`, `e.key === '='`, "Today = Current
  Conditions", `$x/hr × n = $total`, avatar initials `'G'`, GLSL, debug overlays). A second pass for the OLDER `?`
  debris (glyphs an earlier pass had turned into `?`) found 47 sites in 20 files.

## Rules checked before adding anything
- v99 (`constants/emojis.js` header, `.github/workflows/encoding-check.yml`): raw multi-byte emoji corrupt; use
  `\u{...}` escapes. `design_guidelines.json`: "NEVER use AI assistant Emoji characters for icons."
- So: debris removed; meaning kept with words, `&middot;` / `&times;` / `&rarr;` entities (JSX) or `\u00B7` /
  `\u221E` / `\u2192` (JS strings), or lucide icons with `aria-hidden` and a text equivalent. Emoji are added only where
  the emoji IS the data, always as escapes: the shaka reaction (U+1F919, as the file's double-tap already used), the
  crew-chat file prefix (U+1F4CE, what the backend writes), the note pickers' set (`NOTE_EMOJIS`, the original 12 from
  the first commits, in `constants/emojis.js` as that file's header requires), the stoke-level default (mirrors
  `impact_stoked.py`).
- Found on the way: JSX text and JSX attribute strings do not process `\u` escapes. `Auth.js` rendered the literal six
  characters `\u00B7` on the ToS screen; this session's first GPS-guide fix made the same mistake in a `title="..."`,
  caught on review before commit (a babel read-back then showed the decoded arrow). The guard now fails on both.

## Functional defects the debris had caused (fixed)
- `SinglePost` quick-tap shaka sent `'='` as a reaction; backend `VALID_REACTIONS` rejects it.
- Both note pickers (`CreateNoteModal`, `ProfileNoteModal`) inserted `=` into the user's note (duplicate React keys).
- `CrewChat` hid a file message's auto-caption with `startsWith('+-+-++G++-+')`, which never matches the backend's
  `"\U0001f4ce {name}"`; `getFileIcon` returned `=` for every type (two copies; now one, a lucide icon).
- Quick-book and earnings breakdowns printed `$50/hr + 2 hrs` (was U+00D7); a pricing formula likewise.
- Podium ranks 1/2/3 (ChallengesTab, TheInsideHub, ThePeakHub) all rendered `=`: the rank was lost.
- Photo/video counts whose only label was the glyph (GalleryModals, SessionRosterCard) now say photos/videos.
- Settings menu paths and the strike ladder had lost their arrows (`Settings ? Privacy & Security ? ...`).
- The icon-only avatar-mode toggle showed `=` / `???` as its accessible name.

## Commits
- `ac63fcfc` the sweep debris (92 files). `7849e295` the older `?` debris (20 files, 47 sites). `e4a427d7` +
  `e25d155f` the tests. `430d5e05` merged `origin/dev` (#205 had merged at 22:55:23Z): no overlapping files.

## Verification
- ESLint per file vs `0d8e587a` (ESLint API, before = `git show`): 106 files, 211 -> 211 messages, no rule worse.
  (A first attempt with `-f unix` was VOID: that formatter is not installed, so both sides counted 0. Redone.)
- `frontend/scripts/check_eslint.js`: no never-zero rule, nothing over baseline. `scripts/loc_ratchet.py`: 0 new,
  0 regressed. All 112 changed files parse strictly (babel, no error recovery); all are LF in index and worktree.
- Full frontend jest: baseline at `0d8e587a` 302 suites / 2,932 tests, 0 failed; after (with #205 merged in)
  305 / 2,996, 0 failed. +2 suites / +60 tests are this branch's; +1 / +4 are #205's `ContentMarker.test.js`.
- New tests: `encodingDebris.guard.test.js` (20 positive and 18 negative detector controls, then the repo scan,
  >700 files asserted) and `encodingDebris.fixes.test.js` (file icons, prefix parity with `crew_chat_media.py`,
  `REACTION_EMOJIS` == backend `VALID_REACTIONS`, every `handleReaction` literal valid, note pickers, lineup titles,
  the times sign). Mutation: five fixed files put back to `0d8e587a` -> 17 of the 60 tests red (the scan, 8 file-icon
  cases, quick actions, prefix parity, 4 notification titles, the ProfileNoteModal picker, the reaction literals);
  restored with `git checkout HEAD --`.
- Production build (`craco build`, as CI): exit 0; its eslint warnings touch 40 changed files but 0 changed lines.
- Browser (dev server, localhost): the cookie banner's icon slot is `svg.lucide-cookie[aria-hidden=true]` (was `=`);
  no console errors.

## Left alone, deliberately
- Comments (never rendered) and the em dashes / arrows the sweep removed from comments and console text.
- The UTF-8 BOMs the sweep added to file heads (harmless to babel; a whole-file change each).
- `MapForecastOverlay`'s "Loading" (was "Loading…"): reads correctly.
- Pre-existing: ProfileNoteModal's Radix "Missing Description" warning; ErrorBoundary / CookieConsentBanner are
  single-theme (inline dark styles), outside this brief.

## For session c188
- #205's merge (2026-09-30T22:55:23Z, `8abc6e61`, by the owner's account) has no `pr_merge` line yet; it is yours to
  record (the newest merge may wait for the next PR). Not written here, to avoid a duplicate.
- This PR is frontend: its merge restarts Render (W-26), i.e. a cold window for commitment 228's capture.

## PR and ledger (23:14Z-23:17Z)
- #206 opened 2026-09-30T23:14:01Z (GitHub createdAt); ledger seq 231 (`pr_open`); the app bound it, 19 checks
  pending, mergeable.
- **Correction to "For session c188" above:** `memory_audit.py --docs-only` then WARNed "PR #205 ... has no
  `pr_merge #205` ledger line yet: the next PR records it", and #206 is that next PR, so this session recorded it
  (seq 232, `--reconstructed`, merge facts from `gh pr view 205`: 22:55:23Z, `8abc6e61`, mergedBy the owner's
  account; who pressed it is not known here). Session c188: do not write a second line for #205.
- STATE: #206 named, #205 moved to merged, `dev` = `8abc6e61`, anchor moved to seq 232.
