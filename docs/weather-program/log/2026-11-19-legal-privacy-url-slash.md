# 2026-11-19 Privacy-notice link must not be protocol-relative (session `magical-hermann-624553`)

## 2026-11-19 00:10Z (from the UTC clock) Fix built on the #1048 branch

The advisor passed #1048 with one limit: `legal_identity._URL` accepted `//example`, which a browser treats as another
host. An app path is now `/` alone or `/` plus a non-slash character (`/privacy`, `/a/b`); `https://` links are
unchanged; `http://` is still refused. Cases `//evil`, `///x`, `//` are refused in tests. Nothing served moves, so no
SCOREBOARD row. Stacked on `claude/surf-truth-legal-b9a3a1` because #1048 had not merged when this was asked.
