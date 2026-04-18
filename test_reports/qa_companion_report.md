# QA Companion Report (Auto-Updated)
**Generated:** 2026-04-17T23:05:21
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
| ESLint | FAIL | 28 errors, 149 warnings |
| Ruff | PASS | Python backend lint |
| pytest | PASS | 0 passed, 0 failed |

---

## Critical ESLint Errors (severity=error)

- `\src\components\UnifiedAdminConsole.js:1731` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedAdminConsole.js:1732` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedAdminConsole.js:1733` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedAdminConsole.js:1734` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedAdminConsole.js:1735` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedAdminConsole.js:1737` [react-hooks/rules-of-hooks] React Hook "useEffect" is called in function "_AnalyticsTabContent" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedSpotDrawer.js:174` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_PhotographerProfile" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedSpotDrawer.js:175` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_PhotographerProfile" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedSpotDrawer.js:176` [react-hooks/rules-of-hooks] React Hook "useState" is called in function "_PhotographerProfile" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".
- `\src\components\UnifiedSpotDrawer.js:178` [react-hooks/rules-of-hooks] React Hook "useEffect" is called in function "_PhotographerProfile" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word "use".

---

## Action Required

Before marking any task complete, verify: **http://localhost:7734**

Run manually: `cd qa-agent && powershell -ExecutionPolicy Bypass -File run-checks.ps1`
