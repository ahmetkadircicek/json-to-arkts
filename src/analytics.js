// Anonymous visit counts with Cloudflare Web Analytics
// (https://www.cloudflare.com/web-analytics/): no cookies, no fingerprinting,
// no IP addresses stored. It records the page, the referring site, the
// country and the browser type of a visit. The JSON, the generated code and
// the options never leave the browser.
//
// The beacon loads only on the live site, not in automated browsers, and not
// when the browser asks not to be tracked (Do Not Track or Global Privacy
// Control).

// The site token from Cloudflare: Web Analytics, the site, then its JS snippet.
// It is public by design; it shows in the page's script tag. Empty means no analytics.
const TOKEN = 'cbed55b6e5e64dd9b5942b7044496b34';
const LIVE_HOST = 'ahmetkadircicek.github.io';

export function startAnalytics() {
  if (!TOKEN || location.hostname !== LIVE_HOST) return;
  if (navigator.webdriver) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: TOKEN });
  document.head.append(beacon);
}
