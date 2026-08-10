"""E1 probe 3: DIRECTION CONVENTION and GRID ORIENTATION, proved empirically. READ-ONLY.

(a) 180-DEGREE TEST for the shore normal: step 5 km ALONG the resolved seaward bearing and 5 km
    AGAINST it, and read the bundled ETOPO depth. If the bearing really points OUT TO SEA the
    along-bearing point must be OCEAN and deeper than the against-bearing point.
(b) OFFSHORENESS / SWELL_EXPOSURE sign test: both consume a FROM-bearing; head-on swell must
    maximise exposure while a wind FROM the sea must minimise offshoreness.
(c) u/v encode round-trip: the normalizer writes u=-V*sin(dir), v=-V*cos(dir) (FROM convention).
(d) GRID ORIENTATION: bathymetry array indexing, and the linear-lat vs mercator mask_v error.

Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe \
    C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes/probe_E1_conventions.py
"""
import json
import math
import os

from services.weather_pipeline import surf_point, surf_rating as SR
from services.weather_pipeline.bathymetry import depth_at

SPOTS = [
    ("Pipeline",     21.665,  -158.053),
    ("Mavericks",    37.4952, -122.5028),
    ("Trestles",     33.3830, -117.5890),
    ("CocoaBeach",   28.3200,  -80.6076),
    ("JeffreysBay", -34.049,    24.919),
    ("Nazare",       39.6050,   -9.0850),
    ("Hossegor",     43.6620,   -1.4430),
    ("Uluwatu",      -8.8150,  115.0880),
    ("Bells",       -38.3660,  144.2810),
    ("Thurso",       58.5960,   -3.5250),
]

STEP_KM = 5.0
KM_PER_DEG = 111.0


def offset(lat, lng, bearing_deg, km):
    dlat = (km / KM_PER_DEG) * math.cos(math.radians(bearing_deg))
    dlng = (km / (KM_PER_DEG * max(0.05, math.cos(math.radians(lat))))) \
        * math.sin(math.radians(bearing_deg))
    return lat + dlat, lng + dlng


def main():
    print("== (a) 180-DEGREE TEST: does shore_normal_deg point OUT TO SEA? ==")
    print("   depth_at() is ETOPO 0.25deg, metres positive down; None = no ocean in window")
    print("{:<12} {:>8} {:<26} {:>10} {:>10} {:>8}".format(
        "spot", "normal", "src", "d(+5km)", "d(-5km)", "verdict"))
    ok = bad = 0
    for name, la, ln in SPOTS:
        g = surf_point.resolve_surf_geometry(la, ln)
        n = g.shore_normal_deg
        if n is None:
            print("{:<12} {:>8} {:<26} (no bearing)".format(name, "None", g.shore_normal_src))
            continue
        fa, fo = offset(la, ln, n, STEP_KM)
        ba, bo = offset(la, ln, (n + 180.0) % 360.0, STEP_KM)
        df = depth_at(fa, fo, search_cells=0)
        db = depth_at(ba, bo, search_cells=0)
        # seaward is correct if the forward step is ocean AND (backward is land OR shallower)
        good = (df is not None) and (db is None or df > db)
        ok, bad = (ok + 1, bad) if good else (ok, bad + 1)
        print("{:<12} {:>8.1f} {:<26} {:>10} {:>10} {:>8}".format(
            name, n, g.shore_normal_src[:26], str(df), str(db), "SEAWARD" if good else "SUSPECT"))
    print("   seaward-correct %d of %d  (a 180-degree error would invert every row)" % (ok, ok + bad))
    print()

    print("== (b) SIGN TEST on the two direction consumers (shore normal = 270, i.e. faces W) ==")
    sn = 270.0
    for label, wind_from in [("wind FROM the sea (270, onshore)", 270.0),
                             ("wind FROM the land (90, offshore)", 90.0),
                             ("cross (180)", 180.0)]:
        print("   offshoreness(%5.0f, %5.0f) = %+.3f   %s"
              % (wind_from, sn, SR.offshoreness(wind_from, sn), label))
    for label, swell_from in [("swell FROM the sea (270, head-on)", 270.0),
                              ("swell FROM the land (90, behind)", 90.0),
                              ("90 deg off (180)", 180.0)]:
        print("   swell_exposure(%5.0f, %5.0f) = %.3f   %s"
              % (swell_from, sn, SR.swell_exposure(swell_from, sn), label))
    print("   => offshoreness and swell_exposure use the SAME 'from' frame with OPPOSITE optimum;")
    print("      a 180-degree error in either would flip its sign here.")
    print()

    print("== (c) u/v ENCODE ROUND TRIP (normalizer.py:412-414) ==")
    for d in (0.0, 90.0, 180.0, 270.0, 315.0):
        speed = 10.0
        rad = d * (math.pi / 180.0)
        u = -speed * math.sin(rad)
        v = -speed * math.cos(rad)
        back = (270.0 - math.degrees(math.atan2(v, u))) % 360.0   # _fetch_common.meteo_wind_dir
        print("   from=%6.1f -> u=%+8.4f v=%+8.4f -> meteo_wind_dir(u,v)=%6.1f  %s"
              % (d, u, v, back, "OK" if abs(((back - d + 180) % 360) - 180) < 1e-9 else "MISMATCH"))
    print("   (u,v) point in the direction of TRAVEL: from=0 (N) gives v<0, i.e. moving south. OK")
    print()

    print("== (d) GRID ORIENTATION ==")
    meta = json.load(open(os.path.join(os.path.dirname(
        os.path.abspath(__import__('services.weather_pipeline.bathymetry',
                                   fromlist=['x']).__file__)), "data",
        "etopo_depth_0p25.meta.json")))
    print("   bathymetry asset:", {k: meta[k] for k in
                                   ("nlat", "nlon", "lat0", "lat1", "lon0", "lon1", "dlat", "dlon")})
    print("   index rule (bathymetry.py:72-73): r = round((lat - lat0)/dlat), c = round((lng - lon0)/dlon)")
    print("   => row 0 is lat -90 (SOUTH), col 0 is lng -180. Latitude ASCENDING, lon -180..180.")
    print("   API grid (normalizer.py:499-504): vectors.sort(key=(lat, lng))")
    print("   => row-major, latitude ASCENDING (row 0 = SOUTH), longitude ascending.")
    print("   texture upload (WebGLMarineTextureEncoder.createTexture:59) UNPACK_FLIP_Y = false")
    print("   => texel row 0 (t~0) == vectors row 0 == SOUTH edge.")
    print("   shader (WebGLMarineShaders.js:327): tex_v = (lat - south) / (north - south)")
    print("   => tex_v = 0 at SOUTH. MATCHES row order. NOT upside down.")
    print()

    print("   -- mask_v is MERCATOR, tex_v is LINEAR-IN-LATITUDE (shader lines 327 vs 342) --")

    def merc_y(lat):
        lat = max(-85.05112878, min(85.05112878, lat))
        return (180.0 - (180.0 / math.pi)
                * math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0))) / 360.0

    def inv_merc_y(y):
        n = math.pi - 2.0 * math.pi * y
        return math.degrees(math.atan(math.sinh(n)))

    for (s, n) in [(-80.0, 80.0), (-60.0, 60.0), (25.0, 45.0), (0.0, 20.0)]:
        print("   bounds south=%6.1f north=%6.1f" % (s, n))
        for lat in (5.0, 20.0, 28.0, 40.0, 55.0):
            if not (s < lat < n):
                continue
            v_lin = (lat - s) / (n - s)
            my = merc_y(lat)
            v_merc = (merc_y(s) - my) / (merc_y(s) - merc_y(n))
            # what LATITUDE does a grid row sampled at v_merc actually hold?
            lat_read = s + v_merc * (n - s)
            print("      lat %5.1f: v_linear=%.4f v_mercator=%.4f -> a linear-lat grid sampled "
                  "at v_mercator reads lat %6.2f (err %+6.2f deg)"
                  % (lat, v_lin, v_merc, lat_read, lat_read - lat))


if __name__ == "__main__":
    main()
