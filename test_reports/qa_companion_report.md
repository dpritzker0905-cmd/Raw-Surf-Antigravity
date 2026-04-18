# QA Companion Report (Auto-Updated)
**Generated:** 2026-04-17T23:07:51
**Trigger:** 
**Environment:** dev (branch: dev)
**Frontend Under Test:** https://dev--rawsurf.netlify.app
**Backend Under Test:** https://raw-surf-antigravity.onrender.com
**Dashboard:** http://localhost:7734

> âš ï¸ All integration tests target the **dev** deploy. To change, edit `activeEnv` in `qa-agent/config.json`.

---

## Overall: PASS

| Tool | Status | Detail |
|------|--------|--------|
| ESLint | PASS | 0 errors, 153 warnings |
| Ruff | PASS | Python backend lint |
| pytest | PASS | 0 passed, 0 failed |

---

## Critical ESLint Errors (severity=error)



---

## Action Required

Before marking any task complete, verify: **http://localhost:7734**

Run manually: `cd qa-agent && powershell -ExecutionPolicy Bypass -File run-checks.ps1`
