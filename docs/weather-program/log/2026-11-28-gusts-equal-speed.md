# Gusts on the Wind speed scale

The Gusts layer uses peak speed for colour and the background wind vector for particle motion. The peak is a scalar and its reporting interval depends on the source. The existing model credits distinguish GFS instantaneous gusts from the windowed maxima supplied by ECMWF and ICON. The hatch compares the gust to background wind, with the existing 2 kt denominator floor and 1.5× and 2× thresholds. These are display cues. No served forecast number changes.

[ECMWF's six-hour maximum gust definition](https://codes.ecmwf.int/grib/param-db/123) distinguishes a short-duration gust from the period over which a maximum is reported. A [comparison of seven gust parameterizations](https://asr.copernicus.org/articles/15/251/2018/) illustrates the model dependence of the estimate. Context7 confirmed MapLibre's premultiplied-alpha convention for custom layers.

The Gusts legend now uses Wind's colour gradient and tick functions in all three themes. Light uses Wind's field opacity above 40 kt as well. LongCat, SubQ and Reflection reviewed the design and the resulting change summary. None identified a blocker.

Across 151 half-knot samples from 0 to 75 kt, on land and water at zooms 3, 5 and 8, the modeled maximum field difference was 0.32 dE00 for Dark, 0.24 for Light and 0.25 for Beach. Light previously reached 4.1 at 75 kt. The five focused suites passed 79 tests. These comparisons use controlled inputs. The existing two dark low-wind contrast flags still appear in the broader checker.
