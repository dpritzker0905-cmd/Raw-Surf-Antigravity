# 2026-10-18: separate PR378 real-grid replay canary

Owner authorization: "Go ahead with the separate real-grid replay canary. Keep the guard disabled, verify real ICON/EURO data and contributor hashes over HTTP, and leave production and Claude's work untouched."

This chat owns `codex/pr378-real-grid-canary` and only its new canary/workflow and session records. The prior receipt branch remains intact. The branch was fast-forwarded to the preserved canonical receipt, without changing dev/main or another checkout. Runtime Python sources will be independently archived and verified at PR378 merge `6fbf439ac2bb2da5337f9a45864ffd3af8be8423`; newer unrelated backend code on the branch is not imported by the adapter.

Guard stays explicit0. The new capture workflow has no application secrets, no shared concurrency group, no inherited deployment environment, no database/storage writes and a provider-download budget. Only its new branch triggers it. The replay reader will be credential-free, use actual ProductStore/load/estimator/health helpers, and serve a sealed bundle. Existing fixture canary, shared Render API, production, main and Claude's work are excluded. Local preparation and remote acquisition/deployment verification are pending.

## Capture and local reader qualified

Acquisition39170489240 completed successfully at source d4a96d770 after the first job correctly refused a decoder-name assertion. Parameter/file identity and decoded analysis/valid times now qualify each selected native field. All128 saved native/estimated products have nonzero real valid cells; CMEMS coastal missing values are preserved. Guard0 retained. Source archive196 modules, bundle SHA1d622527a910334880c127a65f6b68a84af800366c744d8ef0d1a8cd5178c64d. No raw private/customer data is packaged.

Actual-reader local startup passed6 refusal controls plus cold-load128positive. Independent HTTP verification passed128product-body hashes,48estimates/144contributor links,16cycle cases,48exact frames and48held-hour refusals,10negative routes and4concurrent reads. One initial Windows connection reset preceded a confirmed listening200probe and successful full rerun; it is transport evidence, not a product pass. Independent agent review found no blocking app/bootstrap issue. Linux exact-runtime reader qualification and new-service deployment remain pending. No shared served number changed; forecast skill/global/L2/full-app acceptance stays open.
