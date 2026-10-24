"""Build frontend/public/wave_lakes.json: the outlines of the lakes a wave model carries (2026-10-23, waveLakes.js).

Source: Natural Earth lakes (public domain), ne_50m_lakes.json and ne_10m_lakes.json, as published at
https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson/<res>/physical/ne_<res>_lakes.json (the same repository the app
already reads its 10 m land from). Only the CANDIDATE lakes below are kept: those ECMWF's wave model carries and #497 confirms
(EURO's own values on the Great Lakes, Winnipeg and Victoria; the Caspian and the Black Sea are already water in ne_50m_land).
Lakes near an ocean (Ladoga, Nicaragua, ...) are left out on purpose: a 2-deg node there can be valid from SEA cells, so its value
would paint ocean waves into the lake.

Per lake: id, name, bbox, g50 (the 50 m outline: rings, as published), g10 (the 10 m outline, Douglas-Peucker simplified to
TOL10 degrees), anchors (interior points far from the shore, for the sheltered-water exemption).

    python frontend/scripts/build_wave_lakes.py <dir holding ne_50m_lakes.json and ne_10m_lakes.json> frontend/public/wave_lakes.json
"""
import json
import math
import sys

CANDIDATES = {   # id -> the Natural Earth names (10 m and 50 m spell some differently)
    'superior': ('Lake Superior',),
    'michigan': ('Lake Michigan',),
    'huron': ('Lake Huron',),
    'erie': ('Lake Erie', 'L. Erie'),
    'ontario': ('Lake Ontario', 'L. Ontario'),
    'winnipeg': ('Lake Winnipeg',),
    'victoria': ('Lake Victoria',),
}
TOL10 = 0.01      # ~1 km: finer than a z9 mask texel over the lakes, ~10x fewer vertices than the 10 m source
ROUND = 4


def polygons(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def ring_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def dp(points, tol):
    """Douglas-Peucker on an open polyline (iterative)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tol):
    closed = ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring
    if len(pts) < 8:
        return ring
    half = len(pts) // 2   # split so the closing point is not the only anchor
    out = dp(pts[:half + 1], tol)[:-1] + dp(pts[half:] + [pts[0]], tol)
    return out if len(out) >= 4 else ring


def rnd(ring):
    return [[round(x, ROUND), round(y, ROUND)] for x, y in ring]


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            c = not c
    return c


def anchors(poly, n=3):
    """Interior points far from every ring vertex, spread out (for the sheltered-water exemption)."""
    outer = poly[0]
    xs = [p[0] for p in outer]; ys = [p[1] for p in outer]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    step = max(x1 - x0, y1 - y0) / 40
    verts = [p for ring in poly for p in ring]
    cands = []
    y = y0 + step / 2
    while y < y1:
        x = x0 + step / 2
        while x < x1:
            if inside((x, y), outer) and not any(inside((x, y), h) for h in poly[1:]):
                d = min(math.hypot(x - vx, y - vy) for vx, vy in verts[::max(1, len(verts) // 400)])
                cands.append((d, x, y))
            x += step
        y += step
    cands.sort(reverse=True)
    picked = []
    for d, x, y in cands:
        if all(math.hypot(x - px, y - py) > (x1 - x0 + y1 - y0) / 8 for px, py in picked):
            picked.append((x, y))
        if len(picked) == n:
            break
    return [[round(x, ROUND), round(y, ROUND)] for x, y in picked]


def pick(features, names):
    best = None
    for f in features:
        if f['properties'].get('name') in names:
            for poly in polygons(f['geometry']):
                a = abs(ring_area(poly[0]))
                if best is None or a > best[0]:
                    best = (a, poly)
    return best[1] if best else None


def main(src, out):
    f50 = json.load(open(f'{src}/ne_50m_lakes.json', encoding='utf-8'))['features']
    f10 = json.load(open(f'{src}/ne_10m_lakes.json', encoding='utf-8'))['features']
    lakes = []
    for lid, names in CANDIDATES.items():
        p50 = pick(f50, names)
        p10 = pick(f10, names)
        if p50 is None or p10 is None:
            raise SystemExit(f'{lid}: not found in both sources ({names})')
        g10 = [rnd(simplify_ring(r, TOL10)) for r in p10]
        xs = [p[0] for p in p10[0]]; ys = [p[1] for p in p10[0]]
        lakes.append({'id': lid, 'name': names[0], 'bbox': [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)],
                      'g50': [rnd(r) for r in p50], 'g10': g10, 'anchors': anchors(p10)})
    doc = {'source': 'Natural Earth lakes 50m + 10m (public domain), via martynafford/natural-earth-geojson; built by '
                     'frontend/scripts/build_wave_lakes.py', 'tol10_deg': TOL10, 'lakes': lakes}
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, separators=(',', ':'))
    for l in lakes:
        print(l['id'], 'g50 rings', len(l['g50']), 'pts', sum(len(r) for r in l['g50']), '| g10 rings', len(l['g10']),
              'pts', sum(len(r) for r in l['g10']), '| anchors', l['anchors'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
