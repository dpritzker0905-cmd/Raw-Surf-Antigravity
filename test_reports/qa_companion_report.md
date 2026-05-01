# QA Companion Report (Auto-Updated)
**Generated:** 2026-04-30T23:14:09
**Trigger:** 
**Environment:** dev (branch: dev)
**Frontend Under Test:** https://dev--rawsurf.netlify.app
**Backend Under Test:** https://raw-surf-antigravity.onrender.com
**Dashboard:** http://localhost:7734

> âš ï¸ All integration tests target the **dev** deploy. To change, edit `activeEnv` in `qa-agent/config.json`.

---

## Overall: FAIL

| Tool | Status | Detail |
|------|--------|--------|
| ESLint | FAIL | 261 errors, 498 warnings |
| Ruff | PASS | Python backend lint |
| pytest | PASS | 0 passed, 0 failed |

---

## Critical ESLint Errors (severity=error)

- `\src\contexts\AuthContext.test.js:7` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:8` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:9` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:10` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:11` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:13` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:14` [no-undef] 'jest' is not defined.
- `\src\contexts\AuthContext.test.js:28` [no-undef] 'describe' is not defined.
- `\src\contexts\AuthContext.test.js:29` [no-undef] 'beforeEach' is not defined.
- `\src\contexts\AuthContext.test.js:31` [no-undef] 'jest' is not defined.

---

## Action Required

Before marking any task complete, verify: **http://localhost:7734**

Run manually: `cd qa-agent && powershell -ExecutionPolicy Bypass -File run-checks.ps1`
