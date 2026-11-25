# Clock for the retired-frame freshness test

The retired-record test failed on the DEV base for #1323 once its active GFS fixture was more than 18 hours old. The direct check used fixture noon, while the CLI read the actual UTC time. The test now runs both checks at the same UTC instant and keeps real timestamp parsing and the stale-warning assertion.

On DEV base `270b1d967`, the original test failed locally at an age of 19.3 hours. With the test clock fixed, all 23 tests in the retired-record, raster freshness and publish outcome suites passed. This test repair changes no served weather number.
