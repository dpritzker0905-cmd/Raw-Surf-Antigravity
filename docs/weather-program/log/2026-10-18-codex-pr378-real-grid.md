# 2026-10-18: separate PR378 real-grid replay canary

Owner authorization: "Go ahead with the separate real-grid replay canary. Keep the guard disabled, verify real ICON/EURO data and contributor hashes over HTTP, and leave production and Claude's work untouched."

This chat owns `codex/pr378-real-grid-canary` and only its new canary/workflow and session records. The prior receipt branch remains intact. The branch was fast-forwarded to the preserved canonical receipt, without changing dev/main or another checkout. Runtime Python sources will be independently archived and verified at PR378 merge `6fbf439ac2bb2da5337f9a45864ffd3af8be8423`; newer unrelated backend code on the branch is not imported by the adapter.

Guard stays explicit0. The new capture workflow has no application secrets, no shared concurrency group, no inherited deployment environment, no database/storage writes and a provider-download budget. Only its new branch triggers it. The replay reader will be credential-free, use actual ProductStore/load/estimator/health helpers, and serve a sealed bundle. Existing fixture canary, shared Render API, production, main and Claude's work are excluded. Local preparation and remote acquisition/deployment verification are pending.

## Capture and local reader qualified

Acquisition39170489240 completed successfully at source d4a96d770 after the first job correctly refused a decoder-name assertion. Parameter/file identity and decoded analysis/valid times now qualify each selected native field. All128 saved native/estimated products have nonzero real valid cells; CMEMS coastal missing values are preserved. Guard0 retained. Source archive196 modules, bundle SHA1d622527a910334880c127a65f6b68a84af800366c744d8ef0d1a8cd5178c64d. No raw private/customer data is packaged.

Actual-reader local startup passed6 refusal controls plus cold-load128positive. Independent HTTP verification passed128product-body hashes,48estimates/144contributor links,16cycle cases,48exact frames and48held-hour refusals,10negative routes and4concurrent reads. One initial Windows connection reset preceded a confirmed listening200probe and successful full rerun; it is transport evidence, not a product pass. Independent agent review found no blocking app/bootstrap issue. Linux exact-runtime reader qualification and new-service deployment remain pending. No shared served number changed; forecast skill/global/L2/full-app acceptance stays open.

## Deployment and restart qualified

Exact-reader Linux run39171197972 passed at6f67cdb64842c4985b24072a3d3877638e8ec43a with the minimal pinned reader dependencies and Python3.12.8. A new Free/Oregon service was created outside project environments, with no env group/secrets/disk/DB/jobs and auto-deployOff. Backend source remains6fbf439ac. Its explicit guard0 and bundle hash were verified at startup and over HTTPS. Existing fixture canary and all shared resources were excluded.

Independent HTTPS initially and after an isolated22:19UTC restart passed each of128product-body hashes,48estimates/144contributor links,16cycle cases,48exact frames,48held-hour refusals,10negative routes and4concurrent reads. Full operational health correctly returns503 for absent global lanes; scoped real-cycle diagnostics verify coherent contributors and retain real same-model conflicts. The captured grids have3..6 valid cells of6; no all-null pseudo-pass.

Offline comparison against premerge estimator698ecf6272344af568d31fbb91eadbf689bfc63e produced byte-identical numerical grid payloads for all48real-input estimates with guard0 and zero network attempts. This proves preservation for the sampled inputs, not forecast skill. Source archive/reader is code-pinned separately from the adapter. A raw unpacked-source secret scan produced one false positive: normalizer.py:291 assigns gust_key to weather-field wind_gusts_10m (conditional on wind/ICON/EURO); AST inspection confirmed all literals are weather names. No scanner suppression or push-protection bypass was used.

Sanitized deployment/CI/HTTP evidence: evidence/pr378-real-grid-replay-2026-10-18.json. Private capture, original source chunks, screenshots, startup, numerical parity and HTTP receipts are retained in this chat artifact folder. Only this new disposable service was restarted. The localhost helper was stopped by its exact owned PID/port. No production request or shared forecast change occurred. Continuous ingestion, L2 upload/restore, global coverage, full-app/browser and scientific accuracy remain unqualified.
