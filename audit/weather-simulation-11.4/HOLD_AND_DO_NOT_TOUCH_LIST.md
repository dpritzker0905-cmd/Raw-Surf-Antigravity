# HOLD AND DO-NOT-TOUCH LIST — Audit 11.4

| Item | Why it is held | Gate required before it may resume |
|---|---|---|
| **`marineMaskShelter.js` (the implementation)** | It is verified correct by an independent oracle. Its tests are not. Changing the code while the guardrail is blind removes the only thing that would notice a regression. | Gate C — all ten mutants CAUGHT |
| **Raising the LRU cap above 4** | Deliberate trade, not an oversight: 512 KB/entry, documented Render OOM history, and the panning gain stays bounded by 32% redundancy regardless. A bigger cache is a measurable reversible experiment, not a fix. | Gate C, then a measured experiment with a control arm |
| **Debounce-to-settle for classification** | The correct next perf lever, and the author identified it. But it changes *when* classification runs, which is exactly what a blind hit-path test cannot police. | Gate C |
| **Any further mask/perf optimisation** | Same reason. Six of ten mutations to this subsystem currently ship green. | Gate C |
| **Declaring the mask problem closed** | Explicitly forbidden by the governing document: "⛔ Do not ship the cache and call the mask problem closed." Panning is ~85 ms/s — worse than static was before the cache. The author honoured this; it must stay honoured. | Gate C + a measured panning improvement |
| **WebGPU / renderer work** | Render ownership was not examined in this audit and Gate E is BLOCKED. | Gate E measured, plus Gate C |
| **Zarr / data-pipeline modernization** | Model-run freshness and cache identity were not examined here; audit 11.2 left `F-STALE` findings open. | Its own gate; not touched by this audit |
| **Higher-resolution coastal / nearshore models** | Offshore scientific validation is unrelated to this repair and remains as audit 11.2 left it. | Its own gate |
| **AI-assisted forecast correction** | Deterministic skill metrics still do not exist (open clock ~08-22). | Skill-MAE gate |
| **Removing the `__RAW_DISABLE_SHELTER_CACHE__` kill switch** | It is the rollback lever and the control arm for every future measurement of this subsystem. | Do not remove while the cache exists |
| **Removing `_resetShelterCache`** | It is the only thing preventing module state leaking across test cases. | Do not remove |
| **The `run()` helper in other map test files** | Not audited. If the `created[0]` pattern was copied elsewhere, that is a separate finding — check it, but do not fix it inside the Gate C mission. | Investigate under its own scope |

## Standing repository hazard (not caused by this repair)

**Concurrent sessions share this working tree and the `dev` branch.** This audit observed it live:
the repair was committed by another session mid-audit. Any future audit must re-verify HEAD at
close, not only at start, and must byte-compare what it audited against what exists at the end.
