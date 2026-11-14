/* land-worker-loader.js: runs INSIDE the map library's workers (loaded by maplibregl.importScriptInWorkers; see
 * src/components/map/landMaskSource.js). Not bundled, not run on the page.
 *
 * WHY. A GeoJSON source given a URL has the worker fetch and tile the file, but maplibre-gl 5.24 then sends the fetched
 * GeoJSON BACK to the page in its reply (geojson_worker_source.ts loadData: "Send data only if it was loaded from a URL").
 * For the 18 MB 10 m land file that reply cost the page about 0.65 s in one frame on a 4x-throttled CPU. The page never
 * reads the source's copy of the land (no getBounds / updateData on the ocean mask source).
 *
 * WHAT. A worker-side protocol, `rawland://<encoded file URL>`: fetch the file here and hand the tiler a FeatureCollection
 * whose `features` is NOT ENUMERABLE. The tiler reads `.features` directly; the library's reply serialiser walks enumerable
 * keys only, so the reply carries `{type}` and no geometry. Anything that is not a FeatureCollection passes through as is.
 * Any failure throws, the source reports an error, and the page hands the source the land object (armLandSourceFallback).
 */
/* eslint-disable no-restricted-globals */
(function () {
  var PREFIX = 'rawland://';
  if (typeof self === 'undefined' || typeof self.addProtocol !== 'function') return;
  self.addProtocol('rawland', function (params, abortController) {
    var target = String(params.url).slice(PREFIX.length);
    if (target.charAt(target.length - 1) === '/') target = target.slice(0, -1);
    return fetch(decodeURIComponent(target), { signal: abortController && abortController.signal }).then(function (res) {
      if (!res.ok) throw new Error('land file ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) return { data: json };
      var lean = { type: 'FeatureCollection' };
      Object.defineProperty(lean, 'features', { value: json.features, enumerable: false });
      return { data: lean };
    });
  });
})();
