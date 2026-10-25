/**
 * Page-level accessibility of the HTML shell (audit 2026-10-18, P2 accessibility; WCAG 1.4.4 Resize Text, 1.3.1).
 *
 *  - The viewport meta must not disable pinch-zoom (`user-scalable=no`, `maximum-scale=1`): low-vision users zoom.
 *  - #root must not be a `main` landmark: AppLayout renders the real <main id="main-content">, and a role="main"
 *    wrapper nested two landmarks (and put TopNav's <header>/banner inside a main landmark).
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');
const APP_LAYOUT = fs.readFileSync(path.resolve(__dirname, '../components/routing/AppLayout.js'), 'utf8');

it('the viewport meta allows zoom', () => {
  const meta = HTML.match(/<meta[^>]*name=["']viewport["'][^>]*>/i);
  expect(meta).not.toBeNull();
  expect(meta[0]).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
  const max = meta[0].match(/maximum-scale\s*=\s*([\d.]+)/i);
  expect(max === null || parseFloat(max[1]) >= 2).toBe(true);
});

it('#root carries no landmark role or label', () => {
  const root = HTML.match(/<div[^>]*id=["']root["'][^>]*>/i);
  expect(root).not.toBeNull();
  expect(root[0]).not.toMatch(/\brole=/i);
  expect(root[0]).not.toMatch(/\baria-label=/i);
});

it('the page has exactly one main landmark: AppLayout\'s <main>', () => {
  expect(HTML.match(/<main\b|role=["']main["']/gi)).toBeNull();
  expect(APP_LAYOUT.match(/<main\b/g)).toHaveLength(1);
  expect(APP_LAYOUT).not.toMatch(/role=["']main["']/);
});
