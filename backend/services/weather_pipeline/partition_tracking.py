"""partition_tracking.py -- give swell partitions an IDENTITY before they are interpolated (SURF_PARTITION_TRACKING, dark).

THE DEFECT. GFS-Wave publishes its swell partitions as numbered SLOTS ("SWELL 1/2/3 in sequence"), and WW3 numbers
the watershed partitions PER NODE (WW3 manual §3.12; Hanson & Phillips 2001). So `swell_1` at one node and
`swell_1` at its neighbour, or at the next hour, can be two different wave trains. The point lane samples each
slot as its own layer and blends the four bilinear corners slot by slot (`sampler.sample_point`), so wherever the
ranking flips inside the stencil the blend mixes two swells into a height, period and direction that exist in
neither. Measured offline on public GFS-Wave GRIB (2026-11-02, 16 global fields, log
`2026-11-02-claude-swell-partition-tracking.md`): 14.8 % of coastal 2x2 stencils with a >= 0.3 m swell_1 hold a
slot swap; a coastal neighbour pair swaps swell_1 3.5-7.3 % of the time and swell_2 11.6-16.4 %, with a median
period jump of 2.6-4.6 s between the two trains the blend mixes. A null control (a field against itself) read 0
swaps; a positive control (slots 1<->2 exchanged at half the nodes) recovered 96 % of the injected swaps (the rest
were trains already inside one gate of each other).

THE FIX (Portilla, Ocampo-Torres & Monbaliu 2009; Hanson et al. 2009, partition-matched validation): match the
partitions by direction and period FIRST, then interpolate each matched group.

  * cost(a, b) = (dtheta / SIGMA_DIR_DEG)^2 + (ln(Ta / Tb) / SIGMA_LN_T)^2, dtheta the circular distance in
    degrees (0/360 wraps), SIGMA_DIR_DEG = 30, SIGMA_LN_T = ln 1.25 (25 % in period). A pair matches only when
    cost <= GATE = 1.0: inside the 30-degree x 25 % ellipse. A partition with no direction pays DIR_MISSING_COST
    in place of the direction term, so a bearing-less train can still match on period, but only a close one. A swell
    never matches the wind sea (infinite cost): WW3 classifies the wind sea by wave age, it is not a ranked slot, and
    letting the two trade members moved energy between the kinds the rating treats differently (measured: the
    swell-Hs error grew 0.008 m when they could).
  * The stencil is seeded by its HEAVIEST corner (the largest bilinear weight; first on a tie), whose partitions
    become the groups. Every other corner, heaviest first, is assigned one-to-one to the groups by the minimum
    total cost over all assignments (exhaustive: at most 4 x 4), each accepted pair inside the gate. A partition
    no group accepts starts a new group (a BIRTH); a group with no partition at a corner has zero energy there
    (a DEATH). A merge (one train at a corner where two groups pass) gives the train to the cheaper group, so no
    energy is ever counted twice.
  * Per group, over the stencil's ocean corners (weights renormalised over them, as the sampler's masked branch
    does): energy E = sum(w * h^2) with absent corners contributing 0, Hs = sqrt(E); period = exp of the
    energy-weighted mean of ln T; direction = the energy-weighted mean unit vector. So the sum of the groups' Hs^2
    equals the weighted mean of the corners' partition energies exactly: no energy is fabricated or lost, and a
    train present at one corner of four keeps only that corner's share of energy. Hs is interpolated in ENERGY
    (h^2), not linearly as the scalar sampler does: the two agree where the corners agree, and the downstream
    `reconcile_partitions` rescales the trains to the total Hs either way.
  * `slotwise_partitions` runs the SAME arithmetic with the groups set by slot, i.e. what blending slot by slot
    means in this arithmetic. On a stencil with no swap the two are identical (a test pins it), so the flag moves
    a number only where a swap is.

Time works the same way: `interpolate_hours(a, b, frac)` is a two-corner stencil with weights (1-frac, frac), and
`track_sequence(frames)` carries group ids hour to hour for a series. No server lane blends GFS partitions in
time today (`lattice_fill` finds no GFS gap; `/point` reads one hour), so these are provided and tested, not
wired.

Pure arithmetic plus one adapter (`stencil_from_products`) that reads the four corners of each partition layer
through the sampler's own grid index. No I/O, no env reads: the call sites read SURF_PARTITION_TRACKING.
"""
import itertools
import math

SIGMA_DIR_DEG = 30.0
SIGMA_LN_T = math.log(1.25)
GATE = 1.0
DIR_MISSING_COST = 0.5


def _finite_pos(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if (x == x and x > 0.0 and x != float("inf")) else None


def _clean(p):
    """A usable partition dict {h, tp, dir, kind, ...} or None. NaN / non-positive h or tp is not a train."""
    if not isinstance(p, dict):
        return None
    h, tp = _finite_pos(p.get("h")), _finite_pos(p.get("tp"))
    if h is None or tp is None:
        return None
    d = p.get("dir")
    try:
        d = float(d) % 360.0 if d is not None and float(d) == float(d) else None
    except (TypeError, ValueError):
        d = None
    return dict(p, h=h, tp=tp, dir=d)


def dir_distance(a, b):
    """Circular distance in degrees, 0..180 (359 and 1 are 2 apart)."""
    return abs(((a - b) + 180.0) % 360.0 - 180.0)


def match_cost(a, b):
    """cost of calling partitions a and b one wave train (see the module docstring). Infinite across KINDS: the wind
    sea is classified by a physical criterion (wave age), not ranked into a slot, so it is never a swell's alias."""
    ka, kb = a.get("kind"), b.get("kind")
    if ka is not None and kb is not None and ka != kb:
        return math.inf
    pt = (math.log(a["tp"] / b["tp"]) / SIGMA_LN_T) ** 2
    if a.get("dir") is None or b.get("dir") is None:
        return pt + DIR_MISSING_COST
    return pt + (dir_distance(a["dir"], b["dir"]) / SIGMA_DIR_DEG) ** 2


def _representative(members):
    """The energy-weighted (w * h^2) period (log space) and direction (unit vector) of a group so far."""
    e = sum(w * m["h"] ** 2 for w, m in members)
    if e <= 0.0:
        w0, m0 = members[0]
        return {"tp": m0["tp"], "dir": m0.get("dir"), "h": m0["h"], "kind": m0.get("kind")}
    ln_t = sum(w * m["h"] ** 2 * math.log(m["tp"]) for w, m in members) / e
    sx = sy = ed = 0.0
    for w, m in members:
        if m.get("dir") is not None:
            ew = w * m["h"] ** 2
            sx += ew * math.sin(math.radians(m["dir"]))
            sy += ew * math.cos(math.radians(m["dir"]))
            ed += ew
    d = (math.degrees(math.atan2(sx, sy)) % 360.0) if ed > 0.0 and (sx or sy) else None
    return {"tp": math.exp(ln_t), "dir": d, "h": math.sqrt(e), "kind": members[0][1].get("kind")}


def assign(groups_rep, parts, gate=GATE):
    """Best one-to-one assignment of `parts` to the groups whose representatives are `groups_rep`.

    Returns {part_index: group_index} holding only pairs inside the gate, chosen to maximise the number of
    matched pairs and then minimise their total cost. Exhaustive (<= 4 x 4 here, so <= 24 permutations)."""
    n_g, n_p = len(groups_rep), len(parts)
    if not n_g or not n_p:
        return {}
    cost = [[match_cost(parts[i], groups_rep[j]) for j in range(n_g)] for i in range(n_p)]
    best, best_key = {}, (0, 0.0)
    slots = list(range(n_g)) + [None] * n_p
    for perm in set(itertools.permutations(slots, n_p)):
        pairs = {i: j for i, j in enumerate(perm) if j is not None and cost[i][j] <= gate}
        key = (len(pairs), -sum(cost[i][j] for i, j in pairs.items()))
        if key > best_key or (key == best_key and pairs and sorted(pairs.items()) < sorted(best.items())):
            best, best_key = pairs, key
    return best


def track_stencil(corners, gate=GATE):
    """Group the partitions of a stencil into tracked wave trains.

    corners: [(weight, [partition, ...]), ...]. Returns (groups, weights): `groups` is a list of
    [(corner_index, partition), ...], one list per wave train; `weights` the corner weights renormalised over
    the ocean corners (a corner whose partition list is None is land / masked and drops out)."""
    ocean = [i for i, (w, ps) in enumerate(corners) if ps is not None and w is not None and w > 0.0]
    wsum = sum(corners[i][0] for i in ocean)
    if wsum <= 0.0:
        return [], {}
    weights = {i: corners[i][0] / wsum for i in ocean}
    order = sorted(ocean, key=lambda i: (-weights[i], i))
    groups = []
    for ci in order:
        parts = [q for q in (_clean(p) for p in corners[ci][1]) if q is not None]
        reps = [_representative([(weights[c], m) for c, m in g]) for g in groups]
        pairs = assign(reps, parts, gate)
        for pi, part in enumerate(parts):
            if pi in pairs:
                groups[pairs[pi]].append((ci, part))
            else:
                groups.append([(ci, part)])         # a birth: a train no group accepts
    return groups, weights


def _combine(group, weights):
    """One interpolated partition from a group: energy-conserving Hs, log-space period, vector direction.
    Members are summed in corner order, so the tracked and slot-wise answers share their float arithmetic."""
    group = sorted(group, key=lambda cm: cm[0])
    e = sum(weights[c] * m["h"] ** 2 for c, m in group)
    if e <= 0.0:
        return None
    rep = _representative([(weights[c], m) for c, m in group])
    kind_w = {}
    for c, m in group:
        kind_w[m.get("kind")] = kind_w.get(m.get("kind"), 0.0) + weights[c] * m["h"] ** 2
    kind = max(sorted(kind_w, key=str), key=lambda k: kind_w[k])
    out = {"h": round(math.sqrt(e), 4), "tp": round(rep["tp"], 2),
           "dir": round(rep["dir"], 2) if rep["dir"] is not None else None, "kind": kind}
    return out


def _ordered(parts):
    return sorted((p for p in parts if p is not None), key=lambda p: (-p["h"], p["tp"]))


def tracked_partitions(corners, gate=GATE):
    """The stencil's partitions after tracking, heaviest first: a list of {h, tp, dir, kind}."""
    groups, weights = track_stencil(corners, gate)
    return _ordered([_combine(g, weights) for g in groups])


def slotwise_partitions(corners, slot_key="slot"):
    """The same arithmetic grouped by SLOT (each partition's `slot_key`), i.e. no tracking. The reference the
    tracked answer is compared with; identical to it on a stencil without a swap."""
    ocean = [i for i, (w, ps) in enumerate(corners) if ps is not None and w is not None and w > 0.0]
    wsum = sum(corners[i][0] for i in ocean)
    if wsum <= 0.0:
        return []
    weights = {i: corners[i][0] / wsum for i in ocean}
    by_slot = {}
    for ci in ocean:
        for p in corners[ci][1]:
            q = _clean(p)
            if q is not None:
                by_slot.setdefault(q.get(slot_key), []).append((ci, q))
    return _ordered([_combine(g, weights) for _s, g in sorted(by_slot.items(), key=lambda kv: str(kv[0]))])


def total_energy(parts):
    return sum(p["h"] ** 2 for p in parts if p)


def interpolate_hours(parts_a, parts_b, frac, gate=GATE):
    """Tracked time interpolation between two hours' partition sets (frac 0 -> a, 1 -> b)."""
    frac = min(1.0, max(0.0, float(frac)))
    return tracked_partitions([(1.0 - frac, parts_a), (frac, parts_b)], gate)


def track_sequence(frames, gate=GATE):
    """Persistent ids through a series: frames = [[partition, ...], ...] (one list per hour). Returns one dict
    per hour, {track_id: partition}. A train that matches the previous hour's train inside the gate keeps its id;
    an unmatched one gets a new id (a birth); a previous id with no match ends (a death)."""
    out, prev, next_id = [], {}, 0
    for parts in frames:
        parts = [q for q in (_clean(p) for p in (parts or [])) if q is not None]
        ids = list(prev)
        pairs = assign([prev[i] for i in ids], parts, gate)
        cur = {}
        for pi, part in enumerate(parts):
            if pi in pairs:
                cur[ids[pairs[pi]]] = part
            else:
                cur[next_id] = part
                next_id += 1
        out.append(cur)
        prev = cur
    return out


# ── the adapter: the four corners of each partition layer, through the sampler's own grid index ──────────────

def stencil_from_products(sampler, layer_products, lat, lng):
    """[(weight, [partition, ...] | None), ...] for the bilinear stencil at (lat, lng), or None.

    layer_products: [(product, kind, slot), ...] for the partition layers. They must share one lattice (same
    bounds, rows and cols), or the stencil is not one set of nodes and the caller keeps its untracked answer.
    A corner is OCEAN when any layer has a valid vector there; at an ocean corner a layer whose vector is
    invalid or zero contributes no train (zero energy), never a fabricated one."""
    from services.weather_pipeline.sampler import _from_monotonic_lng, _to_monotonic_lng
    if not layer_products:
        return None
    g0 = getattr(layer_products[0][0], "grid", None)
    for prod, _k, _s in layer_products:
        g = getattr(prod, "grid", None)
        if g is None or not g.vectors or g0 is None or g.rows != g0.rows or g.cols != g0.cols:
            return None
        b, b0 = g.bounds, g0.bounds
        if (b is None) != (b0 is None) or (b is not None and any(
                abs(getattr(b, k) - getattr(b0, k)) > 1e-6 for k in ("west", "south", "east", "north"))):
            return None
    lat, lng = round(lat, 4), round(lng, 4)
    idx = [sampler._grid_index(p) for p, _k, _s in layer_products]
    if any(i is None for i in idx):
        return None
    lats, bounds, lons_mono, _cmap = idx[0]
    lng_mono = _to_monotonic_lng(lng, bounds.west)
    if not (bounds.south <= lat <= bounds.north and lons_mono[0] <= lng_mono <= lons_mono[-1]):
        return None
    lat0, lat1 = sampler._find_surrounding_brackets(lats, lat)
    m0, m1 = sampler._find_surrounding_brackets(lons_mono, lng_mono)
    t = (lng_mono - m0) / (m1 - m0) if m1 != m0 else 0.0
    u = (lat - lat0) / (lat1 - lat0) if lat1 != lat0 else 0.0
    nodes = [(lat0, _from_monotonic_lng(m0), (1 - t) * (1 - u)), (lat0, _from_monotonic_lng(m1), t * (1 - u)),
             (lat1, _from_monotonic_lng(m0), (1 - t) * u), (lat1, _from_monotonic_lng(m1), t * u)]
    corners, seen = [], set()
    for la, lo, w in nodes:
        if (la, lo) in seen:            # a degenerate stencil (edge or exact node) repeats a corner
            continue
        seen.add((la, lo))
        w = sum(ww for la2, lo2, ww in nodes if (la2, lo2) == (la, lo))
        parts, ocean = [], False
        for (prod, kind, slot), (_l, _b, _m, cmap) in zip(layer_products, idx):
            v = cmap.get((la, lo)) or (cmap.get((la, -lo)) if abs(lo) == 180.0 else None)
            if v is None or not sampler._is_vector_valid(v, prod.domain, prod.layer):
                continue
            ocean = True
            h, tp = _finite_pos(getattr(v, "speed", None)), _finite_pos(getattr(v, "period", None))
            if h is None or tp is None:
                continue
            d = getattr(v, "direction", None)
            parts.append({"h": h, "tp": tp, "dir": d, "kind": kind, "slot": slot})
        corners.append((w, parts if ocean else None))
    if not any(ps is not None for _w, ps in corners):
        return None
    return corners


# ── the call-site glue (both partition suppliers: the point lane and the hub) ───────────────────────────────

# The models whose partitions are numbered slots. GFS-Wave (WW3) only: ICON's GWAM publishes ONE total swell, EURO
# publishes none (its period bands are another lane), and the CONSENSUS member blend is consensus_product's.
TRACKED_MODELS = ("GFS",)
_LAYERS = (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))


async def tracked_from_cache(resolver, model, lat, lng, target_dt, untracked):
    """The tracked partitions at (lat, lng) from the locally cached partition grids, or `untracked` unchanged.

    Fails OPEN in every branch: a model outside TRACKED_MODELS, a missing or ratio-derived layer product, layers
    on different lattices, or any error returns the caller's own untracked list, so the flag can only ever
    replace a slot-wise blend with a tracked one, never cost the caller its partitions. Never dials upstream."""
    if not untracked or str(model or "").upper() not in TRACKED_MODELS or target_dt is None:
        return untracked
    try:
        layer_products = []
        for slot, (layer, kind) in enumerate(_LAYERS):
            prod = await resolver.find_cached_grid_product(model, "marine", layer, lat, lng, target_dt)
            if not prod:
                continue
            basis = getattr(prod, "estimate_basis", None)
            if isinstance(basis, dict) and basis.get("method") == "wave_component_ratio_estimation":
                continue                    # a fabricated train is never a train (the suppliers' own guard)
            layer_products.append((prod, kind, slot))
        corners = stencil_from_products(resolver.sampler, layer_products, lat, lng)
        if not corners:
            return untracked
        tracked = tracked_partitions(corners)
        return tracked or untracked
    except Exception:
        return untracked
