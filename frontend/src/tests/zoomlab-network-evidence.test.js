const { attachNetworkEvidence } = require('../../scripts/zoomlab-network-evidence');

test('records DNS attribution while removing private URL components and error text', () => {
  const handlers = {};
  const snapshot = attachNetworkEvidence({ on: (name, fn) => { handlers[name] = fn; } });
  handlers.requestfailed({
    url: () => 'https://user:password@missing.example/private-id?token=secret#fragment',
    resourceType: () => 'fetch',
    failure: () => ({ errorText: 'net::ERR_NAME_NOT_RESOLVED https://example.test/?token=secret' }),
  });
  expect(snapshot()).toEqual({ requests: [{ origin: 'https://missing.example',
    resourceType: 'fetch', errorCode: 'net::ERR_NAME_NOT_RESOLVED' }], dropped: 0 });
});

test('bounds capture and marks unknown origins/errors without exposing their values', () => {
  let failed;
  const snapshot = attachNetworkEvidence({ on: (_, fn) => { failed = fn; } }, 1);
  const request = { url: () => 'data:private', resourceType: () => 'image', failure: () => null };
  failed(request);
  failed(request);
  expect(snapshot()).toEqual({ requests: [{ origin: null, resourceType: 'image', errorCode: 'UNKNOWN' }], dropped: 1 });
});
