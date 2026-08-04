# Audit of the external weather-sim review — 2026-08-03

**Reviewed:** `OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md` (read-only audit, snapshot `e9bd7d55`)
**Method:** every finding re-derived from the cited lines, then **reproduced by execution with controls**.
No finding accepted on a code fact alone — this repo's own recurring failure is "a real code fact,
wrapped in a consequence nobody had measured."

---

## §0 VERDICT: 5 of 5 findings SURVIVE. That is unusual here and worth saying plainly.

| # | claim | code fact | reproduced | severity vs the report |
|---|---|---|---|---|
| 1 | explain() gets the post-gate score | ✅ | ✅ executed | **UNDERSTATED — fires on ~98% of good-surf queries** |
| 2 | `sim_window` publishes an ungated score | ✅ | ✅ read | correct; **and it is not its own defect** — see §2 |
| 3 | margin computed in saturated display space | ✅ | ✅ executed | **UNDERSTATED — it contradicts its own ranking** |
| 4 | failures cached for the positive TTL | ✅ | ✅ executed + 2 controls | **UNDERSTATED — corrects MASTER AUDIT §2b by 60×** |
| 5 | one global breaker couples endpoints | ✅ | ✅ executed | correct; **the compound with #4 is the real story** |

The master audit's own fan-out produced 17 "criticals" of which **0** survived adversarial checking.
This review produced 5 findings of which **5** survive. The difference is method: it cited exact
lines, distinguished a code fact from its consequence, and named where its own probe was mocked.

---

## §1 WHAT THE REVIEW GOT RIGHT THAT I WOULD NOT HAVE FOUND

* **The two-channel thesis is correct and it is the right frame.** The observation gate (#13,
  `79e1001a`) created a second legitimate truth. Every consumer must choose a coordinate.
* **The Jacobian entry `d(display)/d(raw) = 0` above the cap is exactly right**, and it is the
  cleanest statement of why finding 3 matters.
* **It scoped "weather simulation" correctly** — frontend transition-coordinator work vs the backend
  advisor — and refused to let older June reports override the August audit.
* **It declined to tune anything**, and independently reached the same conclusion my spectral work
  reached from the physics side: these are composition/coordinate defects, not weight problems.

---

## §2 ⭐⭐⭐ THE DEEPER FINDING: 1, 2 AND 3 ARE **ONE** DEFECT, NOT THREE

The report lists three consumers each mishandling the split. Forensically they share a single root:

> **`quality_rating` is an unqualified name for two different quantities, and each sibling tool
> picked a different one.**

| surface | what `quality_rating` holds |
|---|---|
| `sim_rating.calculate_surf_rating` (with `valid_time`) | **GATED** — plus `quality_raw` |
| `sim_compare` | **GATED** — plus `quality_raw`, ranks on raw |
| `sim_window` | **UNGATED** — no `quality_raw` field at all |

Three tools of one MCP server publish the same field name meaning different things. That is not a
new class — **this repo has now fixed it three times in one day**:

* `#17`/`0a00766f` — the infobox's bare `Height` was offshore Hs beside a breaking `Surf`;
* `bc304e44` — `/api/conditions/{spot_id}` served BREAKING and OFFSHORE under one `wave_height_ft`;
* and now this.

★ The recorded rule already covers it: **"when two quantities share units, the LABEL is the entire
correctness surface."** Here they share units *and a field name*, across sibling tools.

⇒ **This changes the fix.** The report's implementation order patches three consumers. The root fix
is one contract: name the two channels once at `calculate_surf_rating`'s boundary, make every
consumer declare which it publishes, and add a registry test that every sim surface returning a
score declares its coordinate — the same shape as the `POST_STEPS` registry `79e1001a` added for the
gate itself, and the `GATE_ARG_CALLERS` registry `2680afe7` added when the gate was found inert.

---

## §3 WHERE THE REVIEW UNDERSTATED ITS OWN FINDINGS

### 3a. Finding 1 is not an edge case — it fires on essentially every good-surf query

`observation_gate(s, None) = min(s, 69.9)`, so it binds **iff raw > 69.9 — iff the spot-hour would
read GOOD OR BETTER.** Measured against the reconstruction tolerance (0.15):

    raw  60.0 -> display 60.0   error  +0.00   silent
    raw  69.9 -> display 69.9   error  +0.00   silent
    raw  75.0 -> display 69.9   error  +5.10   WARNING FIRES
    raw  97.3 -> display 69.9   error +27.40   WARNING FIRES

Queue #13 measured `confirmed is None` on **97.9%** of served spots, and the gate binding on 66/999
spot-hours — **exactly** the count with raw ≥ 70.

⇒ **P(self-contradictory response | the user asked about a genuinely good hour) ≈ 98%.** The defect
is not rare; it is *perfectly correlated with the one question the product exists to answer.* A
payload that says `69.9 fair_good`, `97.3 epic`, and "trust the engine, not this breakdown" is at
its worst precisely when a surfer has found a good day.

### 3b. Finding 3 does not merely use the wrong variable — it contradicts its own ranking

Measured, two candidates on a good day, both unconfirmed:

    A raw 97.3 -> display 69.9        RANKER sorts on quality_raw  -> margin 26.3 pts
    B raw 71.0 -> display 69.9        MARGIN uses quality_rating   -> margin  0.0 pts  (< 6.0)

The tool ranks A first on a **26.3-point** lead and then tells the user *"They are not
distinguishable by this forecast — treat them as equal and pick on tide, crowd or access."*

⚠️ Two scoping facts the report omits, one raising severity and one lowering it:
* the note is additionally gated on at least one of the top two carrying a **`degraded`** bearing —
  and 38–40% of served spots do, so the conjunction is common, not exotic;
* it therefore cannot fire when both top spots have `full` geometry, which bounds the blast radius.

### 3c. Finding 4 corrects a **standing master-audit finding by 60×**

MASTER AUDIT 1.0 §2b established that one transient timeout silently changes which spot
`find_best_spot` recommends, and priced the blast radius as a **60 s** breaker window, offering "the
breaker cools down" as the reason it self-heals. With the failure cached the window is **an hour per
key and it does not self-heal.** ✅ **FIXED — `77f66211`.**

### 3d. ⭐⭐ THE COMPOUND OF 4 AND 5, WHICH IS IN NEITHER FINDING ALONE

Measured: inside a two-leg forecast the **failing** leg calls `_mark_down()` and the **healthy** leg
then calls `_mark_up()`.

    composite result : baseline=None   reason="no marine data at this coordinate"
    breaker _is_down(): False          <- the healthy wind leg cleared it
    cache holds       : a FAILURE, TTL 3600 s

**Health says UP while the answer says MISSING, for an hour.** `_mark_up()` erases the evidence;
`_remember()` preserves the consequence 60× longer. That asymmetry is *how this survived unnoticed*,
and it is why the fix is a short negative TTL rather than the report's "do not cache failures" —
**the breaker cannot serve as the backstop, because a healthy sibling leg clears it.** Not caching
at all would re-create the 12-spot × 8 s pile-up the breaker was added for.

---

## §4 WHAT I CHANGED, AND WHAT I DELIBERATELY DID NOT

✅ **Fixed (`77f66211`): the negative cache.** Entries carry their own TTL — a failure gets
`NEGATIVE_CACHE_TTL_S` (defaults to the 60 s breaker cooldown), a success keeps the hour, a
successful retry overwrites. The TTL is stored **per entry**, so raising the env var mid-incident
cannot retroactively extend absences already banked. Kill `SIM_FORECAST_NEG_TTL_S=3600`, which
doubles as the mutation: under it the new guards go red. Five tests, two of them controls that stop
the fix over-reaching (a success must still live the full hour; a failure must still be cached
*briefly*).

⛔ **Not done, and why** — findings 1, 2, 3 are one contract change (§2), not three patches. Doing
them piecemeal is how the repo got three surfaces disagreeing in the first place, and the last
multi-call-site threading here **missed `sim_compare` — the ranker — and changed the winner in 3 of
4 regions** (`a1b320f3`). That change needs the registry + tree-walk coverage test, not three edits.

⛔ **Finding 5's breaker split is not obviously right.** `test_sim_forecast_lane.py:184-205` codifies
catalog failure blocking forecasts, so the coupling is an *encoded contract*, not an accident. The
review says so too. Splitting it is an owner decision; the compound above is the part that is
unambiguously a defect, and the negative-TTL fix already removes its tail.

---

## §5 ONE CORRECTION TO THE REVIEW

> "`sim_forecast.py:103-110` defines a 3,600-second forecast cache TTL … `:114-132` stores and
> recalls values without distinguishing successful from failed fetches."

Accurate. But the suggested repair — *"Do not cache failures"* — would reintroduce the pile-up
`DOWN_COOLDOWN_S` exists to prevent, and the report's own finding 5 is the reason the breaker cannot
cover for it. The correct repair is the one that keeps both properties: **cache failures, briefly.**

---

## §6 INVARIANTS I WOULD ADD TO THE REVIEW'S LIST

* A score field's NAME must determine its coordinate; two coordinates may not share one name across
  sibling surfaces. *(the class behind findings 1–3, and behind `#17` and `bc304e44`)*
* A health signal must not be clearable by a sibling operation that did not succeed. *(§3d)*
* A cached negative must not outlive the mechanism that produced it. *(§3c)*
* Any invariant of the form "every surface does X" needs a registry **and** a negative control —
  the shape `79e1001a` and `2680afe7` both had to add after the fact.
