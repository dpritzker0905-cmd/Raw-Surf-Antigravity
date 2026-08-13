# LV-09 — WS-CAN-0061 Step 0 could not be measured here; the decision table narrowed anyway

**Objective:** WS-OBJ-101 · **Task:** WS-CAN-0061 · **Attempted:** 2026-08-13, `dev` @ `9febd970`
**Surface:** `dev--rawsurf.netlify.app/map` (SW `BUILD_VERSION = 9febd970` = HEAD)
**Outcome:** ⛔ **STOPPED at the packet's own stop condition.** No fix attempted. No file modified.

---

## 1. What the mission asked for, and what came back

Step 0: read `window.__OM_URL_TRACE__.blockedDetail` at the zoom floor.

**It is `null`. `model_lock` never fired.** The branch that fires is `transparent_sentinel`.

Controlled reads (view held still by `jumpTo`, trace cleared, layer toggled, bounds verified
unchanged across calls — `west −145.3 / north 56.67` on every z2 read):

| zoom | layer | `__OM_ACTIVE_MODELS__` | slot-0 tiles | trace `n` | `blocked` | `protocolCalls` |
|---|---|---|---|---|---|---|
| **2.00** | water_temp (active) | `[]` | `om://transparent-tile/{z}/{x}/{y}.om` | 0 | `null` | 0 |
| **3.00** | water_temp (active, **untouched**) | `[]` | `om://transparent-tile/…` | 12 (all z3) | `{transparent_sentinel: 12}` | 0 |
| 3.00 | fog (active) | `[]` | `om://transparent-tile/…` | 0 | `null` | 0 |

## 2. The control refutes the reading — which is why it was run

The z2 → z3 jump changed **only the zoom**; the layer was not touched. If what I had reached were
the zoom-floor defect, z3 would differ. **It is identical**: same sentinel, same empty
`__OM_ACTIVE_MODELS__`, same zero decodes.

⇒ **The state I could reach is not zoom-dependent, therefore it is not the zoom-floor bug.**
The `n` difference (0 vs 12) is tile caching, not behaviour: the z2 sentinel tiles were already
resident before the trace was armed.

**What I actually reached** is a session in which `useOpenMeteoTileUrls` believes nothing is active
— `window.__OM_ACTIVE_MODELS__ = []` at `useOpenMeteoTileUrls.js:540` means
`tasks.filter(t => t.isActive)` is empty — so `:552-557` pins every slot to the sentinel, for every
layer, at every zoom. Meanwhile `__WEATHER_TELEMETRY__.activeLayers` reads `["water_temp"]` and the
button reads `aria-pressed="true"`.

Almost certainly an artifact of activating the layer programmatically rather than by a real pointer
event: `.click()` updated the button and the telemetry but the URL effect did not re-derive.
Toggling a *second* layer (Fog) to force the effect to re-run **did not** change it — `activeLayers`
became `["fog"]` and `__OM_ACTIVE_MODELS__` stayed `[]`.

⚠️ **Recorded, not claimed:** whether a real user can reach this state is **unknown**. It is a
disagreement between two authorities about whether a layer is active, and if it is user-reachable it
is a second blank-layer path. It should not be filed as a defect on this evidence.

## 3. The static narrowing — the useful part

`isModelMatch(folder, lock)` returns **true** early when `folder.toLowerCase().includes('gfs')`.

Every om model folder referenced anywhere in `frontend/src` (12 of them), resolved through
`getParentModel`:

| folder | resolves to | blocked by a mismatched lock? |
|---|---|---|
| `ncep_gfs013`, `ncep_gfs025`, `ncep_gfswave`, `ncep_gfswave025` | **early `true` on `gfs`** | **never** |
| `dwd_gwam`, `dwd_icon`, `dwd_rv`, `dwd_wn` | ICON | only under a non-ICON lock |
| `ecmwf_ifs`, `ecmwf_ifs025`, `ecmwf_waef_member_spread`, `ecmwf_wam025` | EURO | only under a non-EURO lock |

**Not one folder returns an empty parent.** And the two layers the bug was reported on are both
pinned to GFS folders — `fog` is `omModel: "ncep_gfs025"` (`LayerRegistry.js:122`), water temp is
served from `ncep_gfs013` (recorded in `omUrlTrace.js`'s own docstring). **Both hit the `gfs`
early-return. Neither can be blocked by a folder-vs-lock mismatch.**

### Consequence: the packet's decision table should be re-ordered

The packet listed *"two namespaces compared"* first and *"the parse breaks for the floor's URL
shape"* second. **The static evidence inverts that.**

> **Prediction, falsifiable in one read:** when `blockedDetail.model_lock` is finally captured, its
> left-hand side will **not** be any of the 12 folders above. If it is a known non-GFS folder
> (e.g. `ecmwf_wam025`), the cause is a **stale in-flight URL from a previous model**, not a
> namespace mismatch. If it is something else — a path segment, a host, an empty-ish token — the
> **parse** at `openMeteoProtocol.js:742-745` (`pathname.split('/')[2]`) is reading the wrong
> segment for the floor's URL shape.

Both known URL shapes put the folder at `parts[2]`:
`/data_spatial/<model>/latest.json` and `/data_spatial/<model>/<run>/<var>/<z>/<x>/<y>.om`.
So a wrong `parts[2]` implies **a third URL shape that only appears at the floor** — which is
precisely the kind of thing the trace was built to reveal.

## 4. Why this environment cannot finish Step 0

Three independent instrument failures, all consistent with LV-08:

1. **No compositing** — screenshots unavailable, so no visual confirmation of paint.
2. **`read_console_messages` returns nothing at all** — not even the protocol's own
   `[MODEL] [OM-Protocol] Registered with N color scales`, which must have fired. The console
   channel is not wired to this pane.
3. **Async JS eval times out at 30 s reliably**, including an 8-second sleep, so any
   wait-then-read has to be split across tool calls.

The measurement needs a session where the layer genuinely renders — which the owner has and this
pane does not.

## 5. Handover — one line, in a real browser

With fog or water temp visibly painting at z3, hold the view, then:

```js
window.__OM_URL_TRACE__ = { n:0, x:{}, y:{}, z:{}, recent:[], unmatched:0 };
// zoom to 2 WITHOUT panning, wait for tiles, then:
JSON.stringify(window.__OM_URL_TRACE__.blockedDetail)
```

Compare the left-hand side against the 12-folder table in §3. That single string chooses the fix.

⛔ **Do not fix `isModelMatch` on the strength of this note.** Nothing here shows it is wrong; §3
shows the opposite for the two reported layers. What §3 buys is a sharper question, not an answer.
