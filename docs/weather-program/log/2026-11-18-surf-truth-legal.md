# 2026-11-18 Surf-truth legal follow-ups: consent text, distance bands, log retention (session `surf-truth-legal-b9a3a1`)

## 2026-11-18 15:38Z (from the UTC clock) Built and tested locally; PR against `claude/surf-truth-retention` (#1034)

The director assigned this lane after David asked on 2026-11-18 for the legal follow-ups to have a lane of their own.
Its input is the director's research note `T1-LEGAL-RESEARCH-2026-11-18.md`, which is research, not legal advice.
Counsel has reviewed NOTHING, and all wording is DRAFT. The branch is cut from #1034's head 089b113c3 (stack #1022 →
#1024 → #1026 → #1034). Nothing is served: no forecast number moves, so there is no SCOREBOARD row.

1. **Consent text** (`services/surf_truth_consent.py`, version `draft-2026-11-18d`):
   - It adopts the research's proposed text: the Art. 7(3) sentence ("Checks and corrections already made stay"),
     withdrawal "with this same switch", and a privacy-notice link.
   - The company name and the privacy URL are unknown and NOT invented. They appear as `[COMPANY]` and
     `[PRIVACY NOTICE LINK]`, and while either marker is in the wording in force:
     - a grant is refused (409) and `granted_now` is empty, so nothing exports;
     - the admin cannot make such a text active;
     - the app hides the switch.
   - A withdrawal is always accepted.
   - Asked the director (ONE SendMessage, 15:0xZ) for David's answers on the entity name, the privacy URL, and one
     switch or two. I recommended ONE, with "improve" defined narrowly. No answer yet.
2. **Distance bands** (`services/surf_truth_export.py`, schema `raw-surf/surf-truth-export/2`):
   - The legal basis: Cal. Civ. Code 1798.140(w) treats data that locates a person within a 1,850 ft (~564 m) radius
     as precise geolocation.
   - Exact `gps_distance_m` and `exif_distance_m` become `gps_distance_band` and `exif_distance_band`: `<1 km`,
     `1-2 km`, `2-10 km`, `>10 km`.
   - The first band is 1 km, not the brief's example of 600 m. The spot is on a coast, so half the disc is sea, and
     π·600²/2 < π·564². π·1000²/2 is larger.
   - Every edge is a threshold the code already uses: EXIF_OK_M is 1 km, the #989 fit excludes GPS beyond 2 km, and
     GPS_NEAR_M is 10 km. The 2 km edge is inclusive, so `prep.exclusion_reason` gives the same answer from the band
     as from the metres. `test_the_band_cut_is_the_registered_2km_cut_exactly` checks 11 distances across every edge.
   - `gps_check` is no longer exported, because its "ok" means within 500 m.
   - Exports made under schema 1 are refused by `prep.py`, so a fit needs a fresh export. No real export exists yet:
     the stack is unmerged.
3. **Append-only logs**:
   - Design `T1-LOG-RETENTION-DESIGN-2026-11-18.md` and decision D-082 (PROPOSED) set out per-subject keys
     (crypto-shredding) plus monthly partitions. Both leave the immutability triggers intact.
   - Built now: reason CODES in place of free text for anchor status changes and failed audits (API, services and the
     admin `<select>`); `log_action` refuses free-text reasons and any `detail` key outside its allow-list.
   - The retention periods are named constants with the value None in `services/surf_truth_log_retention.py`,
     waiting for David or counsel. A test pins that none is invented.

Tests, run from `backend/` with the local venv (`check_env_parity` warns that 4 declared packages are absent, so this
is evidence about this environment, not CI): the 11 surf-truth/consent files gave **183 passed, 1 skipped**.

- Frontend Jest did NOT run locally: the worktree has no `node_modules`, and a linked copy failed 702 suites on the
  environment. Hosted CI's frontend lane is the check.
- Floor fragments: guards +29 (+1 file), estate +1, frontend +1. The counts are collect-only at base 089b113c3 vs
  head, file by file.

Open, for David or counsel: the controller name; the privacy-notice URL; one switch or two; the claims period for
consent records; anchor and admin log periods; whether to build the shredding mechanism before those answers.

## 2026-11-18 16:24Z (from the UTC clock) David answered: one switch; Raw Surf Adventures Inc.; Company details in the admin; /privacy

These supersede the open items above for the name, the link and the switch count. David typed his answers in this
session; they are quoted in D-083. Checked: no `/privacy` route existed (App.js and the routing components), and the
Privacy Policy appeared only inside Settings > Legal. David's instruction was "if /privacy exists use it, then
build it", so it was built.

- **Company details** (`services/legal_identity.py`):
  - a versioned `tos_content` document, doc_type `company_details`, so it keeps a history and an author with no
    migration;
  - fields: the legal name (default "Raw Surf Adventures Inc."), the privacy link (default `/privacy`) and an
    optional privacy contact, all validated;
  - the admin edits them in Compliance > Legal documents, in a tab right after Terms of Service.
- **Tokens:**
  - `{company}`, `{privacy_url}` and `{privacy_contact}` are filled when the ToS, the Privacy Policy and the consent
    are served;
  - the admin editor loads `raw=true` and so edits the template, never the filled text.
- **Consent `draft-2026-11-18e`:**
  - the served version is `<version>+<8 hex of the filled words>`, so renaming the company asks everyone again;
  - retention now counts a Company details publication as a revocation;
  - the default wording is now final, so grants are accepted. Counsel has still reviewed nothing.
- **Privacy Policy defaults:** sections 1-9 are byte-identical. Two new sections were appended (10 "Who We Are", 11
  "Forecast Data From Your Wave Reports"), in line with "don't overwrite, just append".
  - A Privacy Policy already PUBLISHED in a database is not touched by code. An admin adds the two sections there by
    publishing a new version.
- **New public `/privacy` page** (semantic theme tokens: light, dark, beach). The consent switch links it in a new
  tab.

Tests:
- Backend from `backend/`: **203 passed, 1 skipped** (12 files, local venv).
- Frontend: the Jest suites TrainingConsent, LegalDocumentsEditor, PrivacyPolicyPage and AdminSurfTruthPanel gave
  **19 passed in 4 suites**. They were run from a scratch checkout of the commit outside `.claude`, with
  `node_modules` linked, because Jest finds no tests under the `.claude\worktrees` path.
- `check_eslint.js`: no new debt.
- Not run locally: `npm run build`, and the browser preview of the three themes.
- Floors re-derived: guards +30 (+1 file), estate +7, frontend +5 (+1 suite).

## 2026-11-18 18:43Z (from the UTC clock) Correction option for Company details (David: "Only real name changes")

The advisor asked what a typo fix in Company details does. Until now it re-asked everyone and emptied the next
export. David answered in this session, "Only real name changes", and the T1 session relayed "Yes, correction option"
with three points. All three are built:

1. **A change or a correction:**
   - The consent's served version now follows a Company details REVISION, not the filled words.
   - A CHANGE (a different company or privacy notice) starts a new revision, so everyone is asked again.
   - A CORRECTION keeps the revision, so every consent and every export stays.
   - The admin must pick "A change" or "A correction" before Publish. Nothing is preselected.
2. **The proof:** a new append-only table, `company_details_changes`, gets one row for every publish.
   - Each row holds the old and new details, the filled consent words and version before and after, the kind, the
     revision, and who published it and when.
   - On Postgres it uses the consent-event pattern: triggers refuse UPDATE, DELETE and TRUNCATE, the service role has
     SELECT and INSERT only, and RLS is on.
   - Under a corrected version, the record still shows what each person saw.
3. **No needless export replacement:**
   - Retention now counts a Company details publish as a revocation only when that row says the consent version
     changed.
   - A publish that leaves the consent's filled words untouched keeps the revision, whatever the admin chose. Example:
     setting the privacy contact, which the default consent does not use.

The default served version moved from a hash of the words to a hash of the revision ("default" before any change).
The stack is unmerged, so no stored grant is affected.

Tests:
- Backend: **208 passed, 1 skipped** (12 files). The new tests cover a correction keeping consents and the record
  (old and new words, same version), a no-op publish, retention counting changes but not corrections, and the
  append-only DDL.
- Frontend Jest: **20 passed in 4 suites**, in a scratch checkout.
- ESLint: no new debt.
- Floors: guards +32 (+1 file), estate +10, frontend +6 (+1 suite).
