# 2026-10-18: separate PR378 real-grid replay canary

Owner authorization: "Go ahead with the separate real-grid replay canary. Keep the guard disabled, verify real ICON/EURO data and contributor hashes over HTTP, and leave production and Claude's work untouched."

This chat owns `codex/pr378-real-grid-canary` and only its new canary/workflow and session records. The prior receipt branch remains intact. The branch was fast-forwarded to the preserved canonical receipt, without changing dev/main or another checkout. Runtime Python sources will be independently archived and verified at PR378 merge `6fbf439ac2bb2da5337f9a45864ffd3af8be8423`; newer unrelated backend code on the branch is not imported by the adapter.

Guard stays explicit0. The new capture workflow has no application secrets, no shared concurrency group, no inherited deployment environment, no database/storage writes and a provider-download budget. Only its new branch triggers it. The replay reader will be credential-free, use actual ProductStore/load/estimator/health helpers, and serve a sealed bundle. Existing fixture canary, shared Render API, production, main and Claude's work are excluded. Local preparation and remote acquisition/deployment verification are pending.
