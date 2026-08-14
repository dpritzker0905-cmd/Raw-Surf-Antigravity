# No artifact here — and that is a finding, not an omission

Video WAS produced by this audit (3 configurations) and was deleted under `../.gitignore`, the same
policy Audit 12.1 set: the PNG frames and `coverage-*.json` carry the proof and
`../browser-device-tests/covercap.js` regenerates the video in ~8 min per configuration.

**The recordings that matter are not this audit's.** They are in CI and they are unread:
- `zoomlab-nightly-31680258907` — 59.5 MB, contains `page@*.webm`, **expires 2026-08-27**
- `playwright-report` from run `31751873373` — 7.67 MB, contains a **weather** test failing in
  WebKit, **expires 2026-08-27**

Reading both is VERIFY items V1 and V2 in `../../PATH_FORWARD_12.2.md`.
