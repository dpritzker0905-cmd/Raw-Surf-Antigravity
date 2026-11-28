// Hosted checkout links come from the API. Reject relative or credential-bearing URLs.
export function getCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function navigateToCheckout(url) {
  window.location.assign(url);
}
