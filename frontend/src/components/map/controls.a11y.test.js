/**
 * ACCESSIBILITY: every interactive control needs an ACCESSIBLE NAME (user mandate 2026-07-14).
 * Queue #28, owner-confirmed: four buttons on `/map` had no text, no aria-label, no aria-labelledby
 * and no title — measured live 2026-08-01, 65 buttons scanned, 4 nameless.
 *
 *   map  camera  (featured photographers)  icon-only at every width
 *   map  users   (friends on map)          icon-only at every width
 *   map  layers  (weather layers, mobile)  icon-only at every width
 *   sidebar Create                         named on desktop, ANONYMOUS BELOW xl
 *
 * ⭐⭐ THE `Create` ONE IS THE INTERESTING CLASS, AND IT IS WHY THIS FILE HAS TWO ARMS.
 * Its accessible name is supplied by `<span className="hidden xl:inline">Create</span>` — a span
 * Tailwind hides below 1280px. So the control is named on a desktop and anonymous on a phone: the
 * exact intersection of the ACCESSIBILITY mandate and "ALL DEVICES".
 *
 * ⛔⛔ AND A NORMAL TESTING-LIBRARY ASSERTION CANNOT SEE IT. jsdom applies no Tailwind CSS, so the
 * span is always in the DOM and `getByRole('button', {name: 'Create'})` PASSES while the button is
 * nameless on every phone. **A rendered-name test is structurally blind to a breakpoint-gated
 * label.** That is the same shape as the audit's `SimpleNamespace` guard: a harness that cannot
 * express the defect.
 * ⇒ ARM 2 is a SOURCE-level check: a button whose only name comes from a `hidden …:inline` span
 *   must carry its own `aria-label`. The visible text is a convenience, not the accessible name.
 *
 * ⚠️ `read_page`'s tree is NOT the accessibility name computation — the first pass at #28 mis-flagged
 * the layer toggles (they are fine; their text spans name them) and missed these four.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MapRightControls } from './MapRightControls';

// ── ARM 1: RENDERED — every button carries a non-empty accessible name ────────────────────────

function accessibleName(btn) {
  const aria = btn.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const labelledby = btn.getAttribute('aria-labelledby');
  if (labelledby) {
    const el = document.getElementById(labelledby);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  const title = btn.getAttribute('title');
  if (title && title.trim()) return title.trim();
  return (btn.textContent || '').trim();
}

function baseProps(over = {}) {
  return {
    userLocation: { accuracy: 50 },
    gpsLoading: false,
    locationDenied: false,
    currentUserShooting: false,
    showFeaturedPanel: false,
    showFriendsOnMap: false,
    friendsOnMap: [],
    showGPSGuide: false,
    onGetLocation: jest.fn(),
    onShowLocationPicker: jest.fn(),
    onToggleFeatured: jest.fn(),
    onToggleFriends: jest.fn(),
    onShowGPSGuide: jest.fn(),
    showWeatherControls: false,
    onToggleWeatherControls: jest.fn(),
    activeLayers: [],
    ...over,
  };
}

describe('MapRightControls: no anonymous controls', () => {
  test('every button has an accessible name', () => {
    const { container } = render(<MapRightControls {...baseProps()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(2); // assert the setup actually rendered controls

    const nameless = buttons
      .filter((b) => !accessibleName(b))
      .map((b) => b.getAttribute('data-testid') || b.outerHTML.slice(0, 90));
    expect(nameless).toEqual([]);
  });

  test('the icon-only toggles are named AND report their state', () => {
    render(<MapRightControls {...baseProps()} />);
    // icon-only controls: the name must come from aria-label, and a toggle must say it toggles
    for (const testid of ['featured-photographers-btn', 'friends-on-map-btn', 'weather-layers-btn']) {
      const btn = screen.getByTestId(testid);
      expect(accessibleName(btn)).toBeTruthy();
      expect(btn.getAttribute('aria-expanded')).toBeTruthy();
    }
  });

  test('a toggled control still has a name and flips aria-expanded', () => {
    render(<MapRightControls {...baseProps({ showFriendsOnMap: true, friendsOnMap: [{ id: 1 }] })} />);
    const btn = screen.getByTestId('friends-on-map-btn');
    expect(accessibleName(btn)).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});

// ── ARM 2: SOURCE — a breakpoint-gated label is not an accessible name ────────────────────────
//
// This arm exists because ARM 1 cannot fail on the `Create` button: jsdom has no CSS, so the
// hidden span still contributes text. Read the source instead.

const SRC_ROOT = path.resolve(__dirname, '..', '..');

function jsxButtons(source) {
  // crude but sufficient: each `<button` .. `</button>` region, plus self-closing `<Button ... />`
  const out = [];
  const re = /<button\b[\s\S]*?<\/button>/g;
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
}

const BREAKPOINT_HIDDEN = /hidden\s+(?:sm|md|lg|xl|2xl):inline/;
// ⚠️ `title` COUNTS. The accessible-name computation falls back to `title`, so a button carrying
// one is named at every width even when its span is hidden. The first version of this scanner
// looked for `aria-label` ALONE and flagged `sidebar-active-session`, which has a full `title` —
// a FALSE POSITIVE, i.e. the instrument was wrong and the code was right. (`aria-label` is still
// preferable: `title` is not surfaced on touch and is unevenly supported.)
const HAS_NAME = /(?:aria-label|aria-labelledby|title)\s*=/;

describe('a label Tailwind can hide is not an accessible name', () => {
  const files = [
    path.join(SRC_ROOT, 'components', 'Sidebar.js'),
    path.join(SRC_ROOT, 'components', 'map', 'MapRightControls.js'),
  ];

  test.each(files)('%s: no button relies on a breakpoint-gated span for its name', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const buttons = jsxButtons(src);
    // ASSERT THE SETUP: if the scan finds no buttons the test would vacuously pass.
    expect(buttons.length).toBeGreaterThan(0);

    const offenders = buttons
      .filter((b) => BREAKPOINT_HIDDEN.test(b) && !HAS_NAME.test(b))
      .map((b) => b.replace(/\s+/g, ' ').slice(0, 120));

    expect(offenders).toEqual([]);
  });

  test('the scanner can actually SEE the defect (negative control)', () => {
    // A button named ONLY by a breakpoint-gated span, with no aria-label — the exact `Create`
    // shape. If this does not trip, ARM 2 is watching nothing.
    const broken = `
      <button onClick={x} data-testid="nav-create">
        <Plus className="w-4 h-4" />
        <span className={isHovered ? 'inline' : 'hidden xl:inline'}>Create</span>
      </button>`;
    const found = jsxButtons(broken).filter(
      (b) => BREAKPOINT_HIDDEN.test(b) && !HAS_NAME.test(b)
    );
    expect(found).toHaveLength(1);

    // ...and adding an aria-label clears it, so the check keys on the FIX, not on the markup shape
    const fixed = broken.replace('onClick={x}', 'onClick={x} aria-label="Create"');
    expect(
      jsxButtons(fixed).filter((b) => BREAKPOINT_HIDDEN.test(b) && !HAS_NAME.test(b))
    ).toHaveLength(0);
  });
});
