/**
 * ONE NOTIFICATION MUST NOT HAVE TWO DESTINATIONS.
 *
 * ⛔ THE DEFECT (found by Audit 12.2). A surf alert arriving as a WEB PUSH went to
 * `/map?spot=${data.spot_id}`; the same notification arriving IN-APP went to
 * `/alerts?alert_id=${data.alert_id}`. And `/map?spot=` was inert — `components/MapPage.js` and all
 * of `components/map/` contain zero `useSearchParams` / `location.search` / `URLSearchParams`
 * (positive control: 19 files elsewhere in `src/` do use `useSearchParams`). So tapping the push
 * landed the user on a generic map at whatever viewport they left, with the spot id discarded.
 *
 * `/alerts` is the destination that actually reads its parameter — `components/SurfAlerts.js:90`
 * does `searchParams.get('alert_id')`.
 *
 * ⚠️ WHY THIS IS A SOURCE-LEVEL GUARD. `service-worker.js` is not an importable module: it runs in
 * the SW global scope (`self`, `addEventListener`) and is served from `public/` verbatim. A
 * behavioural test would need a SW harness the estate does not have. Reading the routing rule out
 * of the source is the weaker check, and it is the one that can exist today — stated plainly rather
 * than dressed up, because "there was no test" is how these two drifted apart in the first place.
 */
import fs from 'fs';
import path from 'path';
import { getNotificationDeepLink } from './notificationDeepLinks';

const SW = path.join(__dirname, '..', '..', 'public', 'service-worker.js');
const swSrc = fs.readFileSync(SW, 'utf8');

/** The `targetUrl = ...` assignments inside the surf_alert branch of `notificationclick`. */
function swSurfAlertTargets() {
  const i = swSrc.indexOf("data.type === 'surf_alert'");
  expect(i).toBeGreaterThan(-1);                       // control: the branch exists at all
  const branch = swSrc.slice(i, swSrc.indexOf('else if', i));
  return branch.match(/targetUrl\s*=\s*([^;]+);/g) || [];
}

describe('surf-alert deep link parity', () => {
  test('the service worker sends a surf alert to /alerts, not to a query nothing reads', () => {
    const targets = swSurfAlertTargets();
    expect(targets.length).toBeGreaterThan(0);
    const joined = targets.join(' ');
    expect(joined).toContain('/alerts');
    expect(joined).not.toContain('/map?spot=');
  });

  test('it carries alert_id, which is the parameter the destination consumes', () => {
    expect(swSurfAlertTargets().join(' ')).toContain('alert_id');
  });

  test('the in-app router agrees with it — THE PARITY ASSERTION', () => {
    const inApp = getNotificationDeepLink({
      type: 'surf_alert', data: { alert_id: 'a1', spot_id: 's1' },
    });
    expect(inApp.route).toBe('/alerts?alert_id=a1');

    const sw = swSurfAlertTargets().join(' ');
    // both must name the same route and the same parameter
    expect(sw).toContain('/alerts');
    expect(sw).toContain('alert_id');
    expect(inApp.route.startsWith('/alerts')).toBe(true);
  });

  test('an older payload without alert_id still lands somewhere real, on BOTH paths', () => {
    expect(getNotificationDeepLink({ type: 'surf_alert', data: { spot_id: 's1' } }).route)
      .toBe('/alerts');
    // the SW's fallback is the same bare route
    expect(swSurfAlertTargets().join(' ')).toMatch(/'\/alerts'|"\/alerts"|`\/alerts`/);
  });
});
