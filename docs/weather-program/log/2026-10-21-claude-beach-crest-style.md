# 2026-10-21 · Claude · beach crest style: visible crests in beach's own colours (owner A/B)

Session: the beach crest session (started by the lead, local_d6b521eb; its earlier log is
`log/2026-10-20-claude-beach-crest-v2.md` on PR #416's branch). Branch `claude/beach-crest-casing` from dev `a25aaa8ae`.

## The request

The lead relayed the owner's words on the live dev deploy (2026-10-21 08:02 EDT): "I do not like the animation colors of light
mode, with dark animations mixed with yellow ones, its not pleasing to the eye as a good representation of waves moving. The
original was better. And the animations for beach mode, its hard to see the crests colors against some of the heatmap."
Beach keeps the v1 sea (D-035). The crests must become visible on it without the dark/light colour flip he rejected (#416's crest
is that pattern, so #416 is relabelled reference-only). Brief: measure where today's beach crests fail, build 2-3 one-colour-family
candidates with kill switches, check colour blindness and APCA per band, show them moving side by side on an owner A/B page.

## Where today's beach crests fail (as the engine draws the sea)

`frontend/scripts/wind-color/beach-crest-style.mjs` (new): the v1 wash at each zoom state's measured alpha (PR #425's law:
no regional tile at world and fresh regional zoom; BLEND BOTH once one is resident), each crest sampled at its centre, body and edge
as DRAW_FS shades them (today's self-contrast below 1.05 m and in the z ~3.6-4.3 band included), APCA |Lc| of the best part, worst
over swell lighting and whitecap, every 0.2 m.

- World z2.2, coastal z7.4 and close z10: |Lc| < 30 at 48-49 of 50 heights. Fresh regional and zoomed-out regional (the
  self-contrast band): 18-19 of 50 (0.2-1.4 m and 5.4-8 m).
- |Lc| 0 on the sea-green/sand band (1.0 m, 1.6-2.2 m: mauve-pink crest on `#c7a78c`) and the maroon/grey-mauve band (4.4-6.8 m:
  magenta crest on `#84798a`). Leonardo's APCA (wcag3) agrees: `#c13ed8` on `#84798a` Lc 0; `#aba0b2` on `#c8b092` Lc 0;
  control `#ffbbf6` on `#2e969b` Lc -38.6 (the grid says 39).

## Why the answer is a luminance structure, not a new colour

A crest colour that varies smoothly with height and keeps its hue cannot avoid matching the brightness of a sea whose brightness
goes up and down (light at 1.2 m sand and 10 m cream, dark at 0 m teal and 5 m maroon): it must cross it somewhere unless it is
darker, or lighter, than the whole sea (the fixed-point argument). Always-darker crests become near-black at the maroon band (the
owner rejected dark inks in dark mode); always-lighter cannot beat the 10 m cream. A crest that carries BOTH a dark part and a light
part escapes it: one of the two always stands off the sea. That is road casing in cartography (a darker casing under a lighter fill)
and the engine's own self-contrast (dark skirt, brighter core), which today runs only in one zoom band and below 1.05 m.
Perception: motion is seen mainly through luminance (Livingstone & Hubel 1987; direction is lost at isoluminance, Lindsey & Teller
1990); elements that move together read as one field when they look alike (Gestalt common fate + similarity), which is why a
height-threshold colour flip read as two populations.

## Candidates (marineBeachCrestStyle.js; levers `window.__RAW_BEACH_CREST_STYLE__`, kill `__RAW_DISABLE_BEACH_CREST_STYLE__`)

| style | what | model: heights < 30 (world / storm fresh / storm out / coast / close) | worst \|Lc\| | colour-blind | engine p99 \|Lc\| world / storm / coast |
|---|---|---|---|---|---|
| today | as shipped | 49 / 18 / 19 / 48 / 49 | 0 | 3.6 | 1.0 / 22.7 / 33.9 |
| twotone | rim x0.30 + centre 75% to white, opaque to 0.80 | 0 / 0 / 0 / 0 / 0 | 35.2 | 25.0 | 18.0 / 23.7 / 51.0 |
| soft | rim x0.30 + centre 55% | 4 / 3 / 3 / 3 / 3 | 27.8 | 22.5 | 17.9 / 21.1 / 49.2 |
| cased | the engine's self-contrast everywhere | 20 / 18 / 19 / 17 / 19 | 17.9 | 14.6 | 12.4 / 31.2 / 59.9 |

Engine: offline harness, paired exact wash, 24 frames per view, coloraide LUT; colour-blind p99 world 10.8 -> 14.0 / 14.1 / 11.6,
coast 33.4 -> 42.9 / 42.6 / 42.9. Regional differences sit inside that view's run-to-run null (today 8.3, cased 13.9: the storm
moves through it). At world zoom crests are a few pixels wide, so rim and centre blend and the engine gain (|Lc| 1 -> 18; pixels
standing off by 15+: 0.2% -> 2.1%) is below the model's. Each pane's compiled style was read back from the GPU and every DRAW program
linked. Rejected without building: (b) a continuous same-hue lightness shift (the fixed-point argument above) and (c) bolder/wider
crests alone (modelled: still under 30 at 41-45 heights at world/coast/close).

Every style keeps beach's crest colours; with no lever DRAW_FS is today's byte for byte (pinned), each lever changes three lines,
each gated on `u_theme > 1.5`; the shader stays at 978 lines. Moving A/B: real-time recordings (Playwright recordVideo) of the
flow world -> regional -> coastal -> four forecast steps, trimmed and played in sync on the owner page.

Tools asked for and their status: mapbox-cartography and hyperframes-animation skills consulted (generic; the casing practice is
the cartographic one above); Leonardo APCA used; Elicit refused (plan without API access); Consensus failed to connect; Reflection
not consulted (its server is for the user's own requests).

Evidence: `docs/weather-program/evidence/beach-crest-style-2026-10-21.json`.

Draft PR #433; owner page https://claude.ai/artifact/LebieAg312hzjyruotS9KN (private to the owner). Ledger 1563 (`pr_open`),
1564 (`commitment`: the owner's pick by 2026-10-24). Local checks at `cf90d4474`: Jest 460/461 suites (the known
`netlifyIconStoredTailScope` spawn timeout, same on dev), `check_eslint.js` debt down, `loc_ratchet.py` 0 new / 0 regressed,
`craco build` compiled, flake8 clean.

## 2026-10-21 afternoon: two-tone bold, re-measured on dev 73e25a908 (#430)

Corrections and direction, in order:
- The lead relayed the owner's direction: keep today's beach crest colours ("I do like the blueish color wave animations on the
  big waves on beach mode that is live on dev now ... Only some of the areas blend"); either a heatmap or a crest fix is fine. The
  lead's seafoam research candidate (one near-white core + ink casing) was built (seafoam / seabold levers) and then dropped.
- My first model put every crest at its 0.85 alpha cap. Far out the engine draws crests at ~0.3-0.6 (DRAW_VS zoomAlphaScale 0.45
  below z3), so plain two-tone still blended: under |Lc| 30 at 40 of 100 heights at world zoom (engine p99 18.0). The model now
  uses the engine's real per-zoom crest alpha, every 0.1 m, and #430's calm-hold wash law. The lead was told.
- The owner asked for the best option; I recommended two-tone with beach crest alpha x3 before the cap, and he said: "Yes: build
  two-tone bold (two-tone with beach crest opacity x3 before the cap), re-measure on dev 73e25a908, record the moving A/B against
  today, put it first on the page as the recommendation, and send me and the lead the link."

Built (`8cd43c9bf`, after merging dev `5be9e9dd0`): `window.__RAW_BEACH_CREST_STYLE__ = 'twotonebold'`, listed first; one more
wired line (`boostedAlpha = alpha * (u_theme > 1.5 ? 3.00 : 1.0) * mix(...)`, the 0.85 cap kept); seafoam/seabold removed.

Model on dev 73e25a908 (heights under |Lc| 30 of 100: world / storm fresh / storm zoomed out / coast / close; worst; colour-blind):
- today: 100 / 80 / 76 / 98 / 99; 0; 1.5.
- twotonebold: 0 / 0 / 0 / 0 / 0; 35.2; 23.3 (inner edge 66.9).
- twotone: 40 / 28 / 27 / 6 / 3; 10.8; 9.1. soft and cased: worse (evidence).
Engine (paired exact wash, p99, today -> twotonebold): world |Lc| 0.0 -> 44.0, colour-blind 10.3 -> 37.7, crest pixels at |Lc| 15+
0.1% -> 16.2%; storm 26.5 -> 45.4 (colour-blind 26.4 -> 40.9); coast 34.2 -> 53.3 (34.8 -> 47.7). Plain twotone: 18.0 / 22.5 /
47.7. Null (half vs half) <= 9.8. Every pane's compiled style read back; every DRAW program linked.
Colour-blind 30 (the lead's ask) is not reachable without a heavier rim, which changes the look; left at 23.3 (model).
Harness fix: VIDEO=1 marks are now timed from page creation (the recording's start); they were late by the browser launch time,
so the first trims caught the storm where the world view was meant.

Ledger lines 1563-1564 were re-chained after dev's head as 1573 (`pr_open`) and 1574 (`commitment`).

## 2026-10-21 evening: merge-ready, lever-only, ledger-free

The lead, relaying the owner ("resolve all the conflicts and merge, communicate between sub chats"; "we need the fixes that we want
to go through properly, so make sure we're merging everything correctly"): #433 merges LEVER-ONLY (beach's default byte for byte as
dev), then the owner is asked to switch two-tone bold on.
- Merged dev 23a91534f (#438 light restore D-041, #419 dark cased 8 m+ D-039, #428 density D-042), then dev d84a94f26 (#431 light
  spectrum wash D-037, #441, #427), which landed during the first merge. Shader conflicts were the import lines and the
  self-contrast line: every side kept (dev's density, dark storm ink and spectrum-lift imports beside the beach style import;
  dark's casing term with the beach style head in front). The shader stays at 978 lines; its diff against dev is the five beach
  lines.
- With no beach lever DRAW_FS is dev's byte for byte: marineBeachCrestStyle.test.js now pins dev's default hash (e2438586..., 8872
  characters, the value marineCrestPaletteLight.test.js pins), and the light V2 + dark kills still give the pre-V2 shader (a9e8e102...).
- The branch carries no ledger lines: ACTIONS.jsonl and STATE.md are dev's. My three lines (pr_open #433, the commitment for the
  owner's pick, the push) are in the lead's receipts PR.

Correction (same evening, from the lead): another session's permission check flagged removing ledger lines from a branch as
audit-log tampering, so #433 keeps its lines. The merge with dev had taken dev's ACTIONS.jsonl, which dropped them on the branch
(they had never reached a merged ledger). They are now re-chained once after dev's head, append-only, with their original acted-at:
1607 (`pr_open` #433), 1608 (`commitment`: the owner's pick by 2026-10-24), 1609 (`push`, the two-tone bold push), plus 1610 (`push`:
the two dev merges and this re-chain). STATE's anchor is moved to 1610. If #437 merges first, the lead names the head to re-chain onto.

## 2026-10-22: no two-tone; the beach crest style code removed

- 02:34Z the owner picked "Turn the crest edge on for both light and beach (beach with the zoom taper)" (relayed by the lead). Light
  went on separately (#445, D-043). I built the combined flip on a local branch (`claude/crest-edge-on`, 5886da38f, never pushed):
  beach two-tone bold by default with light's z9 taper; offline GPU run (light, beach, dark x today/on x world, regional, coastal):
  every DRAW program compiled and linked, gl.getError() 0; model with the taper: heights under |Lc| 30 0/0/0/0/3 (the 3 at z10 on
  0.2-0.4 m seas, worst 26.4), colour-blind worst 17.8 (23.3 with a flat x3).
- 03:55Z the lead paused it: the owner said light's deployed two-tone "look[s] strange"; he then agreed to turn light's back off.
- 04:04Z the owner to me: "No two-tone, they don't look like real waves in my opinion"; 04:10Z: "Remove the unused beach two-tone code
  from dev (keep today's beach crests exactly)."
- Done (this PR): the module, its test, its four shader hooks and import, the harness's beach variants and the model script are
  removed. Proof: DRAW_FS / DRAW_VS hash as dev 67021e936 under the default, light's kill, light V2 and dark's kill (a temporary Jest
  probe, both trees); Jest 478/479 suites (only the known netlifyIconStoredTailScope spawn timeout), check_eslint 0 new,
  loc_ratchet 0 new / 0 regressed, craco build compiled. The local flip branch stays unpushed.
- Lesson: a luminance structure inside a moving crest (dark outline, white core) reads as a drawn symbol, not lit water; the owner
  judges crests by whether they look like real waves first, contrast numbers second. The blend on beach's sand and grey-mauve bands
  is still open.
