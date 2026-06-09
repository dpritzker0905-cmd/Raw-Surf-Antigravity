import { parseWeatherProductId, isProductMatching, normalizeWeatherLayer } from '../components/map/weatherProductIdentity';

describe("Weather Product Identity - Parser", () => {
  test("1. Parses EURO wind_waves product", () => {
    const parsed = parseWeatherProductId("euro_marine_wind_waves_florida_east_coast_20260620T000000Z_estimated.json");
    expect(parsed.model).toBe("EURO");
    expect(parsed.layer).toBe("wind_waves");
  });

  test("2. Parses EURO waves product", () => {
    const parsed = parseWeatherProductId("euro_marine_waves_florida_east_coast_20260620T000000Z_estimated.json");
    expect(parsed.model).toBe("EURO");
    expect(parsed.layer).toBe("waves");
  });

  test("3. Parses GFS swell_2 product", () => {
    const parsed = parseWeatherProductId("gfs_marine_swell_2_florida_east_coast_20260620T000000Z.json");
    expect(parsed.model).toBe("GFS");
    expect(parsed.layer).toBe("swell_2");
  });

  test("4. Parses GFS swell_1 product", () => {
    const parsed = parseWeatherProductId("gfs_marine_swell_1_florida_east_coast_20260620T000000Z.json");
    expect(parsed.model).toBe("GFS");
    expect(parsed.layer).toBe("swell_1");
  });

  test("4b. Parses GFS generic swell product as swell_1", () => {
    const parsed = parseWeatherProductId("gfs_marine_swell_florida_east_coast_20260620T000000Z.json");
    expect(parsed.model).toBe("GFS");
    expect(parsed.layer).toBe("swell_1");
  });

  test("4c. Parses GFS swell_height product as swell_1", () => {
    const parsed = parseWeatherProductId("gfs_swell_height_florida_east_coast_20260620T000000Z.json");
    expect(parsed.model).toBe("GFS");
    expect(parsed.layer).toBe("swell_1");
  });

  test("5. Parses viewport GFS waves product", () => {
    const parsed = parseWeatherProductId("viewport_gfs_marine_waves_20260607T040000Z_-157.17_-12.29_-5.83_57.57.json");
    expect(parsed.model).toBe("GFS");
    expect(parsed.layer).toBe("waves");
  });

  test("6. Parses GFS wind product", () => {
    const parsed1 = parseWeatherProductId("gfs_wind_20260607T040000Z.json");
    expect(parsed1.model).toBe("GFS");
    expect(parsed1.layer).toBe("wind");

    const parsed2 = parseWeatherProductId("viewport_gfs_wind_20260607T040000Z.json");
    expect(parsed2.model).toBe("GFS");
    expect(parsed2.layer).toBe("wind");
  });

  test("7. Parses pressure and precipitation products", () => {
    const parsedPressure = parseWeatherProductId("gfs_weather_pressure_msl_20260620T000000Z.json");
    expect(parsedPressure.model).toBe("GFS");
    expect(parsedPressure.layer).toBe("pressure");

    const parsedPrecip = parseWeatherProductId("icon_weather_precipitation_20260620T000000Z.json");
    expect(parsedPrecip.model).toBe("ICON");
    expect(parsedPrecip.layer).toBe("precipitation");
  });
});

describe("Weather Product Identity - Matcher", () => {
  test("1. euro_marine_wind_waves does not match waves", () => {
    const match = isProductMatching("euro_marine_wind_waves_florida_east_coast_20260620T000000Z_estimated.json", "EURO", "waves");
    expect(match).toBe(false);
  });

  test("2. euro_marine_wind_waves matches wind_waves", () => {
    const match = isProductMatching("euro_marine_wind_waves_florida_east_coast_20260620T000000Z_estimated.json", "EURO", "wind_waves");
    expect(match).toBe(true);
  });

  test("3. gfs_marine_swell_2 does not match swell_1", () => {
    const match = isProductMatching("gfs_marine_swell_2_florida_east_coast_20260620T000000Z.json", "GFS", "swell_1");
    expect(match).toBe(false);
  });

  test("4. gfs_marine_swell_1 does not match swell_2", () => {
    const match = isProductMatching("gfs_marine_swell_1_florida_east_coast_20260620T000000Z.json", "GFS", "swell_2");
    expect(match).toBe(false);
  });

  test("5. viewport_gfs_marine_waves matches waves", () => {
    const match = isProductMatching("viewport_gfs_marine_waves_20260607T040000Z_-157.17_-12.29_-5.83_57.57.json", "GFS", "waves");
    expect(match).toBe(true);
  });

  test("6. Wind products do not match wind_waves and wind_waves do not match wind", () => {
    const windProduct = "gfs_wind_20260607T040000Z.json";
    const windWavesProduct = "gfs_marine_wind_waves_20260607T040000Z.json";

    expect(isProductMatching(windProduct, "GFS", "wind")).toBe(true);
    expect(isProductMatching(windProduct, "GFS", "wind_waves")).toBe(false);

    expect(isProductMatching(windWavesProduct, "GFS", "wind_waves")).toBe(true);
    expect(isProductMatching(windWavesProduct, "GFS", "wind")).toBe(false);
  });

  test("7. Unknown product fails closed", () => {
    expect(isProductMatching("unknown_file_format.json", "GFS", "waves")).toBe(false);
    expect(isProductMatching("", "GFS", "waves")).toBe(false);
    expect(isProductMatching(null, "GFS", "waves")).toBe(false);
  });

  test("8. Correctly normalizes weather/marine layer UI aliases", () => {
    expect(normalizeWeatherLayer("swell")).toBe("swell_1");
    expect(normalizeWeatherLayer("primary_swell")).toBe("swell_1");
    expect(normalizeWeatherLayer("swell 1")).toBe("swell_1");
    expect(normalizeWeatherLayer("swell2")).toBe("swell_2");
    expect(normalizeWeatherLayer("swell 2")).toBe("swell_2");
    expect(normalizeWeatherLayer("secondary_swell")).toBe("swell_2");
    expect(normalizeWeatherLayer("wind waves")).toBe("wind_waves");
    expect(normalizeWeatherLayer("wind wave")).toBe("wind_waves");
    expect(normalizeWeatherLayer("waves_combined")).toBe("waves");
    expect(normalizeWeatherLayer("combined_waves")).toBe("waves");
  });
});

describe("Weather Product Identity - Strict Matching & Security Validation", () => {
  test("1. Model substring matches are strictly rejected", () => {
    // Should not match GFS, EURO, or ICON loosely
    const badGfs = parseWeatherProductId("notgfs_waves.json");
    expect(badGfs.model).toBeNull();

    const badEuro = parseWeatherProductId("eurocopter_waves.json");
    expect(badEuro.model).toBeNull();

    const badIcon = parseWeatherProductId("iconic_waves.json");
    expect(badIcon.model).toBeNull();
  });

  test("2. Model ambiguity/mutual exclusivity causes fail-closed", () => {
    // If multiple models are detected, the result should fail-closed (return null)
    const ambiguous = parseWeatherProductId("gfs_copernicus_waves.json");
    expect(ambiguous.model).toBeNull();
  });

  test("3. Layer substring matches are strictly rejected", () => {
    // Should not match wind, waves, pressure, precipitation, or swell loosely
    const badWind = parseWeatherProductId("gfs_windows.json");
    expect(badWind.layer).toBeNull();

    const badWaves = parseWeatherProductId("gfs_microwaves.json");
    expect(badWaves.layer).toBeNull();

    const badPressure = parseWeatherProductId("gfs_lowpressure.json");
    expect(badPressure.layer).toBeNull();

    const badPrecip = parseWeatherProductId("gfs_coprecipitate.json");
    expect(badPrecip.layer).toBeNull();

    const badSwell = parseWeatherProductId("gfs_swellings.json");
    expect(badSwell.layer).toBeNull();
  });

  test("4. Path and URL pollution is ignored for token extraction", () => {
    // Windows paths
    const winPath = parseWeatherProductId("c:\\gfs_data\\euro_waves.json");
    expect(winPath.model).toBe("EURO");
    expect(winPath.layer).toBe("waves");

    // Unix paths
    const unixPath = parseWeatherProductId("/var/log/gfs/icon_wind.json");
    expect(unixPath.model).toBe("ICON");
    expect(unixPath.layer).toBe("wind");

    // Query parameters & hashes
    const urlPath = parseWeatherProductId("http://example.com/gfs/icon_wind.json?query=gfs#hash_gfs");
    expect(urlPath.model).toBe("ICON");
    expect(urlPath.layer).toBe("wind");
  });

  test("5. Layer ambiguity/mutual exclusivity causes fail-closed", () => {
    // If multiple distinct layers are detected, the result should fail-closed
    const ambiguous = parseWeatherProductId("gfs_wind_pressure.json");
    expect(ambiguous.layer).toBeNull();
  });
});

