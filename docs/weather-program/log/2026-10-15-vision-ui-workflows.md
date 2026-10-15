# Surfboard Scan and Gallery Hub photo review

Owner request: "Can you add the surfboard Scan button and connect photo analysis and tagging to the main Gallery Hub, then test them in dev? Keep the $10 cap enabled and production locked."

## Candidate implementation

Based directly on dev a7c038919. Earlier deployment/real-photo receipt commits remain on
codex/openai-cap-deploy-record; their shared ledger suffix was not imported into this branch.

- Gallery Hub AI Tag opens its existing Tag & Assign review dialog. A photo chooser analyzes one selected
  owned item through /ai/suggest-tags and displays scene description, people count and visual tags.
  Videos are excluded; multi-selection limits the chooser. No automatic paid batch or identity matching.
  Existing manual participant/search assignment and distribution remain explicit.
- Add/Edit Surfboard offers Scan Surfboard after photo upload. Existing board ID is sent for ownership
  validation. Detected details are displayed before an explicit Use suggestions action fills empty fields.
  Manual details and measurements remain untouched; unsupported board/fin values are ignored. Save remains separate.
- Shared review panel uses semantic theme tokens, a native labeled photo chooser, loading/status/error text,
  no automatic request/retry, and request-version invalidation on photo/board changes or unmount.
  Board dialog has semantic theme styling and accessible upload/remove/save controls.
- No backend, model, budget, key, migration, Render deployment or production-publishing change.
  No served weather number changes.

Focused checks: 20 passed across seven suites, including existing vision/recap controls. Production build passed
with existing repository warnings; frontend lint debt gate passed (zero newly introduced errors).
First full frontend run: 433 suites passed, one failed; three recap cases found duplicate AI Tag names after
making toolbar actions accessible. Toolbar actions now distinguish selected photos versus folder photos.
Fresh full suite and hosted/dev acceptance are pending at this candidate record.

The prior real-upload session ended with enabled budget 3.70 reserved / 6.30 remaining. This is a conservative
reservation bound, not provider charges. Read live again before any paid browser acceptance; never reset it.
Production frozen frontend fc140024 must remain locked.

## Local qualification and publication

Final full frontend434 suites/5568 tests passed after accessible toolbar names were disambiguated.
PR337 opened against dev from source bcebc1765535f5b81d00cd66255c798d533f9ec3; hosted checks and
Netlify preview started. Live read-only process confirmed effective budget true, initialized true, limit10,
reserved3.70. Netlify showed Auto Publishing Locked and frozen fc140024. No paid call or deployment in this step.

## PR337 hosted, merge, dev deployment and real-photo acceptance

Final qualified head5cfdcf7cc1d8ad202844e591b625866f9b7af0fe: all20 contexts accepted (19success/one neutral).
Hosted CI38819679095 frontend434/5568; composition2725collected/195files,2658passed67skipped0failed0errors.
Merged2026-10-15T23:09:35Z as5ec87562d45abef96c97d1f160de39ee0d176b84; exact merge tree comparison passed.
Skip markers suppressed automated deploys. Netlify dev-only Retry with latest branch commit produced successful
6ad15d3ab666b55ca20e9af3 at exact5ec87562d; public dev worker5ec87562. Backend remained healthya7c038919.
Production Auto Publishing Locked/frozenfc140024 read back before and during rollout. No Render/migration/key action.

Uploaded a real licensed JPEG through main Gallery Hub into a disposable non-sale folder. The existing gallery
items endpoint filters is_public even for the owner: initially hiding the item made the folder look empty. Used
normal upload item visibility for this public licensed photo, leaving the folder's private flag; do not claim this
legacy endpoint provides access control. No customer photos used. The image attribution was set on the QA item.
Source: Travisthurston, https://commons.wikimedia.org/wiki/File:Riley-fish-Marlin2.jpg , CC BY-SA3.0;
app generated original and watermarked preview. Temporary non-sale board reused the uploaded original.

New main Gallery Hub toolbar and summary AI Tag both opened description/tag review with manual assignment.
First Scan Photo returned the honest provider502 error, with no retry. Read-only HTTP/PIL confirmed all stored
variants were valid single-frame JPEGs450x201,200image/jpeg. One budgeted isolated-process diagnostic using the
unchanged deployed helper succeeded. One explicit UI retry then displayed scene description, zero people and
surfboard/wood-finish/logo/isolated-object tags. No identity matching, person assignment or notifications.

Board edit Scan Surfboard succeeded on the stored original; readable evidence and unknown fields were displayed.
Before Use suggestions / Save, DB description remained empty. Explicit apply filled description while keeping
entered shaper and six-foot length; explicit Save persisted description with entered values and null unknown model.
The original real board was untouched. Four paid attempts total (one failed UI, one diagnostic, two successful UI)
advanced permanent reservations3.70 ->5.10, leaving4.90 (14attempts). These are conservative bounds, not invoices.
No reservation refunded/reset; guard stayed enabled. Fixtures remain isolated pending final visual-only follow-up.

Browser result screenshots revealed new native chooser and board inputs brown rgb120,53,15 on black in beach.
Global index.css forces that brown text with important. Follow-up changes only those field/option surfaces to
pale amber in beach; other themes retain their semantic surfaces. Seven focused suites22tests passed and changed
file ESLint had no errors/warnings. No further paid scans are needed for the color check.

Owner approved temporary390x844 mobile override after automatic review first rejected it. The documented capability
returned successfully but both existing/fresh dev tabs stayed1280x575. Override reset. Actual mobile browser
acceptance remains unverified; do not count the desktop screenshot as mobile proof.

## Earlier broad E2E qualification limit

Read-only job metadata reconfirmed cap-release run38811839375/job116686721168 failed its exact frontend-source
wait while dev was stillf2d339e6. Node/dependency/browser setup, exact backend-source wait and Run E2E were skipped.
This is unqualified frontend/browser coverage, not an observed browser regression. It does not invalidate the
separately evidenced cap backend/migration/accounting/denial smoke. PR337 hosted results and this task's manual
vision acceptance have their own exact sources above; no broad E2E pass is claimed for the split frontend/backend.

## Final contrast qualification, deployment and cleanup (23:50Z)

PR338 exact checked head c6afdc866113b6ba19a6b18a04ef1e5f3021bf5d passed all20 contexts (19success/one neutral).
CI38823251816 hosted frontend434suites/5570tests and build passed; composition succeeded. Local seven focused
suites22tests and changed-file lint passed. The small contrast change added two tests. Merged23:40:46Z as
48284a5e307f65f24b6b9287ed9332598deaf0e7; merge tree equals checked head. Skip markers retained deployment control.
Dev-only Netlify6ad164925cb9cf4277547969 serves48284a5e; live Gallery Hub chooser and board Brand field computed
rgb120,53,15 on rgb255,251,235 (8.75:1). The entered QA shaper and6ft remained visible with saved scan description.
No additional provider attempt for this visual follow-up. Production Auto Publishing Locked and workerfc140024;
shared backend healthya7c038919, unchanged. No backend deploy/restart, key, migration, budget or flag change.

Approved browser viewport override returned success but had no effect; reset it. An isolated local harness built
from the actual candidate components instead rendered real390x844 iframe browsing contexts (client/scroll width390,
height844). Light/dark/beach layouts, scrolling/focus, mocked scan/results/apply and preserving entered shaper passed.
The side-by-side page's left is photo description/visual-tag review and manual surfer assignment; right is board
scan/review/apply before explicit save. All responses labeled Local mocked are synthetic, with no provider network.
This is responsive component evidence, not whole deployed app/device or matching evidence. The earlier real dev
tests used the uploaded licensed image and OpenAI. Scene/board analysis does not establish a rider's account identity.

Broad postmerge E2E38821861231 passed exact frontend gate at23:11:55Z but failed exact backend gate at23:28:59Z;
Run E2E was skipped. The shared backend intentionally stays on the qualified capped a7 source. No backend rollout
was performed merely to make frontend/backend SHAs equal; premerge source checks/manual UI evidence remain separate.

Cleanup verified exact QA gallery/item/board IDs and common owner, non-sale state, no purchases/tags/assignments,
and two-board pre-count. First guard stopped before any deletion because the saved form stores unknown model as
an empty string, not SQL null. Read-only verification confirmed the empty string; narrowed correction accepted
that unknown representation. This corrects the earlier shorthand null-model claim: no model was invented.
Removed only those records and two deduplicated original/preview storage objects through the storage API; exact
filename listing confirmed absence. Fresh DB read: gallery0, items0, board0; original quiver count1. No profile
created/deleted, customer data changed, or notifications/assignments/purchases made. Storage cache purge not claimed.
Final read-only budget: effective enabled true, initialized true, limit10, reserved5.10, available4.90. Four paid
attempts in this task permanently reserved1.40; one provider failure and one isolated diagnostic included. No refund,
reset, cap opt-out or additional paid acceptance. Counter values are conservative reservations, not actual invoices.

Canonical docs updated by exact replacements, logs/ledger appended from canonical dev prefix, without importing
the conflicting historical receipt-branch suffix. No served weather number changed and no scoreboard gain claimed.

## Source-only linkage map at48284a5e

Read-only follow-up on the intended quiver/photo/claim relationship; no additional implementation, tests, provider
calls or customer queries. The new controls do not complete a board-to-rider matching pipeline.

| Path | Connected source and concrete limit |
| --- | --- |
| Profile quiver | `frontend/src/components/surfboards/SurfboardModal.js` calls the shared `ImageVisionPanel`; `backend/routes/ai/ai_tagging.py:568` checks JWT and optional board owner, returns saved:false. Explicit apply fills empty form fields; Save uses existing board CRUD in `backend/routes/surf_data/surfboards.py`. No identity association or match evidence is persisted by Scan. |
| Main Gallery Hub | `frontend/src/hooks/useGalleryDistributionActions.js:123` opens Tag & Assign; `GalleryModals.js` embeds photo analysis. `/ai/suggest-tags` in `ai_tagging.py:66` checks item owner and uses its stored URL, returns descriptive visual_tags and an empty suggested_tags identity list. It does not read the quiver, existing claims or participant reference images. |
| Manual assignment | `useGalleryDistributionActions.js:125` posts `/gallery/{id}/tag-item`; `backend/routes/gallery/distribution_tagging.py:34` checks supplied photographer/gallery and item membership, then `services/gallery_distribution.py:293` persists SurferGalleryItem, manual provenance and a claimed training-queue record. This path is source-connected but was not executed against real surfers in this task. Caller-to-photographer binding is not shown in that handler; do not treat this bounded trace as full authority qualification. |
| Recalled suggestions | `/ai/face-match` at `ai_tagging.py:442` retrieves prior PhotoTag, pending claim-queue and participant-context records with static/default scores; despite its name it does not inspect pixels or use saved board scan details. The public-gallery action calls that endpoint. Existing labels/scores do not demonstrate a calibrated match. |
| Legacy quiver matching | `services/ai_lineup_match.py:24` queries Surfboard for primary_color/secondary_color, but those fields are absent from the current Surfboard model. Its analyzer at65 passes filename and participant-description text to Cloudinary classification, then derives reasons/scores from text/categories. Main Hub no longer invokes `/gallery/trigger-ai-match`. This legacy path cannot be counted as working image-backed quiver matching. `ai_gemini_matcher.py` has separate provider/reference logic but bounded caller search found health-only imports, not a new Gallery Hub call. |
| Review and claim fallback | `frontend/src/hooks/useSurferGalleryActions.js:49` loads claim queue and posts action; `components/surfer-gallery/ClaimQueueItem.js` offers That's me/Not me. `backend/routes/surfer_gallery/claims.py:46` checks queue owner/pending state then writes SurferGalleryItem and claimed/rejected state. `surfer_gallery_review_pkg/self_claim.py:26` supports authenticated session-participant self-claim, writes pending_selection (not a paid entitlement) and manual training metadata. No current frontend `/self-claim` caller found in this bounded search. Separate TaggedPhotoModal claim posts `/gallery/items/{id}/claim`, whose handler checks current tagged user/free eligibility and serializes duplicate purchases. These paths were not live exercised by this UI task. |

Additional gaps: claim UI reads `item.confidence` while the queue schema names `ai_confidence` (no normalization in
the fetching hook); manual/self-claim numeric scores1.0/0.95 are provenance conventions, not measured model accuracy.
`services/ai_identity_matching.py` deliberately returns unavailable/zero and `/gallery/{id}/find-me` returns503
before charging or writing claims. No active matcher training/learning from the recorded training rows was found
in this bounded trace. Stronger evidence fusion, uncertainty handling, actual review/claim wiring, ownership
qualification and live end-to-end acceptance remain separate work. Board resemblance is a clue, never identity proof.

Source-trace correction before publication: the queue-confidence mismatch suspicion above is ruled out.
`backend/routes/surfer_gallery/gallery_core.py:257` explicitly maps cq.ai_confidence to response `confidence`
(line287), matching ClaimQueueItem. The typed response schema alone was insufficient evidence. This is a working
field mapping, not a bug. Manual/self-claim numeric scores still describe recorded provenance, not model accuracy.
