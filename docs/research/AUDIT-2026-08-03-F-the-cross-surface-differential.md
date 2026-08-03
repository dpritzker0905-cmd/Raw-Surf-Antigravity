# AUDIT 2026-08-03 (F) — the CROSS-SURFACE DIFFERENTIAL

**A deliberately different method from audits v7 and E.**

| audit | method | what it can see |
|---|---|---|
| v7 | black-box, replay the client's URLs, measure a **distribution** | cost/latency modes invisible at n=1 |
| E | re-measure at larger **n**, on a different frame; check each instrument against the rule it measures | sample-size and scope errors |
| **F (this one)** | ask **DIFFERENT SURFACES** about the **SAME spot-hour** and diff them | a defect that is **self-consistent inside each surface** and only visible between them |

⭐ Only a differential can find a number that is wrong *nowhere in particular*. Both prior methods
re-sample one surface, so a surface that is internally coherent but disagrees with its siblings is
invisible to them. This audit tests CLAUDE.md's **binding** rule directly: ONE FORECAST COMPOSITION.

---

## §1 THE MANDATE HOLDS WHERE IT WAS CHECKED

`get_weather_forecast` already publishes a `parity` block — served vs sim, **both halves** — and
nobody had read it across spots. It is the cheapest differential in the repo.

| spot | served height | sim height | Δ | served score | sim score | level differs |
|---|---|---|---|---|---|---|
| Raglan – Manu Bay | 2.5937 m | 2.5908 m | **−0.11%** | 2.7 | 2.8 | no |
| Cloudbreak | 1.9449 m | 1.9507 m | **+0.30%** | 4.6 | 4.4 | no |

`reconstruction_error: 0` on both — the nine-factor product re-derived exactly. **This is the
composition mandate genuinely holding**, and it is worth recording as a pass, not just a non-finding.

## §2 ⛔ THE THIRD SURFACE DISAGREED BY A LEVEL

| | Nai Harn, 2026-08-03T17:00Z |
|---|---|
| **sim** | **70.5 `good`** — `quality_raw` 70.5, `quality_confirmed` null |
| **app** | **66.4 `fair_good`** |

`sim_rating.calculate_surf_rating` applies the observation gate **only `if valid_time is not None`**.
`weather_sim_mcp.get_weather_forecast` **parsed** the hour, **used it for the baseline two lines
above**, and never threaded it into the rating call.

⭐⭐⭐ **The sim was the only surface in the product able to say "good" — and only because it was
skipping the cap every glyph applies.** That is precisely the asymmetry owner-decision #13 closed on
2026-07-31, silently re-opened by a parameter default.
Verified: `gate_single_model_surface(70.5, Nai Harn, 17:00Z) → 69.9 'fair_good'`. Fixed `2680afe7`.

★ **THE CLASS: an optional argument with a `None` default does not fail — it DISABLES the feature
that depends on it.** Fourth instance this session, after the ring reader with zero call sites, the
ERA5 guard blocking its own launcher, and `limiter` dropped at the Pydantic boundary.

## §3 ⛔⛔ WHY THE EXISTING GUARD WAS GREEN THROUGH IT — two structural holes

`test_rating_composition_parity.py` asserts each surface **REFERENCES** `gate_single_model_surface`.
`sim_rating` does — behind a condition its caller never satisfies.

1. **REFERENCING A STEP IS NOT APPLYING IT.** A conditional step passes a name-scan forever.
   ⇒ new registry `GATE_ARG_CALLERS` — *this caller must pass this keyword to this callee*,
   AST-checked. **Two registries, because there are two distinct failure modes:** a surface that
   never applies a step, and a caller that leaves a conditional step **un-armed**.
2. **THE GUARD COULD NOT REACH THE SURFACE THAT HAD THE DEFECT.** `_references` used
   `importlib.import_module`; `weather_sim_mcp.py` imports **fastmcp**, install-incompatible with the
   pinned stack (every published fastmcp needs `httpx>=0.28.1` vs our pinned 0.27.2). So the MCP
   surface was left out — and the registry asserted *"all five rating surfaces must be listed"*
   **while listing four.** ⇒ `_source_of` now reads a surface **by path**, no import.
   ★★ **A registry whose own count contradicts its own comment is telling you something.**
3. ⚠️ `weather_sim_mcp` is deliberately **not** added to `POST_STEP_SURFACES`: it **delegates** the
   gate rather than referencing it, so that registry's question is the wrong one there. **Adding the
   missing surface to the wrong registry is not coverage** — the first attempt did exactly that and
   failed for the wrong reason.

Mutation-tested: reverting the fix in memory makes the new guard fail. **526 passed, 15 skipped.**

## §4 THE CAMPAIGN GATE — a landmine found before spending 38 hours on it

`_prod_credentials` is named "prod" and returns **whatever `os.environ` holds**, checking the process
env *before* discovering the real values from Render — and `backend/.env` points at the **DEV**
project (`weewaulkwfwlbhqemxma`, vs production `jnfbxcvcbtndtsvscppt`). Anyone who sources `.env`
silently retargets the campaign, and **an inbox write against the wrong project succeeds**, which is
indistinguishable from success.
⇒ `era5_deepen_climatology` now **prints its resolved project ref** and **refuses to upload** unless
it matches. Fired correctly against a deliberately wrong expectation before the campaign launched.

## §5 THE PROBE — first run, first limitation

`directional_exposure_probe --spots-file` over 12 floored spots (8 `full`, 4 `degraded`, biggest surf
first — Raglan Manu Bay at 2.7 on 8.5 ft, Cloudbreak 4.6).
**Control (Hossegor) returned cleanly: 0.3% floored overall, 0.0% of its top decile.**
⚠️ **Both Raglan spots VOIDED — *"0 usable samples"*** — ERA5's ~0.5° wave grid has no usable ocean
cell at that coordinate. **The refusal firing is the probe working**, and it is a real constraint:
a learned per-spot transform inherits that hole, so the training set's **coverage must be measured,
not assumed.**
⚠️ Stopped mid-run: the probe and the campaign share the CDS queue and starved each other
(campaign hadn't finished spot 1 in ~10 min). **Serialise CDS jobs.** Re-run the probe after the
campaign, or against spots the campaign has already fetched.

## §6 WHAT CAUGHT WHAT

| caught by | count |
|---|---|
| cross-surface differential | 1 (§2 — the level disagreement) |
| reading a guard's own registry against its own comment | 1 (§3) |
| tracing a credential resolver before a long job | 1 (§4) |
| a control that could exonerate | 1 (§5 — Hossegor clean, Raglan void) |
| mutation | 1 (the new guard) |
| **review / green suite** | **0** |

⭐ A postscript that makes the point better than the audit does: the script I wrote to kill the probe
**killed itself** (exit 15) — its own command line contained the probe's filename, so it self-matched.
That is the *same class* as the ERA5 launcher bug fixed hours earlier, reproduced live, by me,
knowingly. **The class is not rare and knowing it is not sufficient — the guard has to exclude self
and ancestors, every time.**
