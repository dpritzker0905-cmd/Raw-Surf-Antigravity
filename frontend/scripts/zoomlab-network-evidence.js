/** Retain failed-request attribution without URL paths, credentials, queries or headers. */
function attachNetworkEvidence(page, limit = 200) {
  const requests = [];
  let dropped = 0;
  page.on('requestfailed', (request) => {
    if (requests.length >= limit) { dropped += 1; return; }
    let origin = null;
    try {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
    } catch (_) { /* Unknown origin remains explicitly unknown. */ }
    const error = request.failure()?.errorText || '';
    requests.push({
      origin,
      resourceType: request.resourceType(),
      // Error text can contain arbitrary URLs; retain only Chromium's diagnostic code.
      errorCode: error.match(/\bnet::ERR_[A-Z_]+\b/)?.[0] || 'UNKNOWN',
    });
  });
  return () => ({ requests: requests.slice(), dropped });
}

module.exports = { attachNetworkEvidence };
