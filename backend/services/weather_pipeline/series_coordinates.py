"""Select the historical series grid before allocating its coordinate pairs."""
import math

RESOLUTIONS = (.25, .5, 1., 2., 2.5, 5., 10., 15., 20., 30., 40.)
POINT_LIMIT = 500


def _axis_count(start, end, step):
    """Count with the generator's floating-step endpoint rule, stopping above the cap."""
    count = 0
    while start <= end + .0001:
        count += 1
        if count > POINT_LIMIT:
            return count
        following = start + step
        if following == start:
            raise ValueError('Coordinate step cannot advance at this magnitude')
        start = following
    return count


def series_resolution(w, s, e, n):
    """The ladder resolution generate_series_coords picks for this bbox, without allocating a coordinate.

    Split out 2026-09-30 (commitment 228) so the series builder can ask what grid the live lane WOULD
    fetch before deciding whether to fetch it at all. generate_series_coords calls this, so the two
    cannot disagree.
    """
    if not all(math.isfinite(value) for value in (w, s, e, n)):
        raise ValueError('Coordinates must be finite')
    for resolution in RESOLUTIONS:
        rows = _axis_count(s, n, resolution)
        cols = (_axis_count(w, e, resolution) if w <= e else
                _axis_count(w, 180., resolution) + _axis_count(-180., e, resolution))
        if rows * cols <= POINT_LIMIT or resolution == RESOLUTIONS[-1]:
            return resolution


def generate_series_coords(w, s, e, n):
    """Return (resolution, latitudes, longitudes) with unchanged accepted coordinates.

    Count each axis rather than materializing rejected Cartesian products. Keep the
    old ladder, epsilon, dateline seam duplication and last-tier behavior. The final
    coordinate generator remains the single authority for rounding and ordering.
    """
    from services.weather_pipeline.route_helpers import generate_bbox_coords

    resolution = series_resolution(w, s, e, n)
    lats, lons = generate_bbox_coords(w, s, e, n, resolution)
    return resolution, lats, lons
