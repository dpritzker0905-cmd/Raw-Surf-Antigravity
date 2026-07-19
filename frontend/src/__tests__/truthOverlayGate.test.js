/**
 * DIAGNOSTICS HUD PROD GATE (2026-07-19).
 *
 * TruthOverlay — the full Diagnostics HUD — was mounted UNCONDITIONALLY by MapWebGL: a 360px
 * dark panel fixed bottom-left over the live map for EVERY production user (nearly full-width
 * on a 390px phone), found while inspecting wind-sweep screenshots. Same class of dev chrome
 * as MarineAnimTuner, which has been prod-gated all along — the HUD simply never got the gate.
 *
 * The RENDER is gated; the truth-violation POST telemetry effect inside the component is NOT —
 * /api/weather/client-diagnostics is a real, tested backend route consuming those reports, so
 * production keeps reporting while showing nothing.
 *
 * Gate contract mirrors MarineAnimTuner.isEnabled exactly:
 *   '0' in localStorage.__RAW_DIAG__  -> OFF everywhere (probes use this — a HUD inside the
 *                                        screenshot crop biases every pixel metric)
 *   ?diag=1                           -> ON anywhere
 *   localStorage.__RAW_DIAG__ = '1'   -> ON anywhere
 *   localhost / 127.0.0.1 / 0.0.0.0   -> ON by default (dev experience unchanged)
 *   anything else                     -> OFF (production)
 */
import { isDiagHudEnabled } from '../components/map/TruthOverlay';

const fakeWin = ({ host = 'app.example.com', search = '', ls = {}, lsThrows = false } = {}) => ({
  location: { hostname: host, search },
  localStorage: {
    getItem: (k) => { if (lsThrows) throw new Error('privacy mode'); return ls[k] ?? null; },
  },
});

describe('Diagnostics HUD production gate', () => {
  it('is OFF for production hosts by default', () => {
    for (const host of ['app.example.com', 'raw-surf-antigravity.onrender.com', 'www.rawsurf.app', '10.0.0.5']) {
      expect(isDiagHudEnabled(fakeWin({ host }))).toBe(false);
    }
  });

  it('is ON by default on dev hosts (unchanged local workflow)', () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0']) {
      expect(isDiagHudEnabled(fakeWin({ host }))).toBe(true);
    }
  });

  it("'0' suppresses everywhere and OUTRANKS every enable — the probe contract", () => {
    expect(isDiagHudEnabled(fakeWin({ host: 'localhost', ls: { __RAW_DIAG__: '0' } }))).toBe(false);
    expect(isDiagHudEnabled(fakeWin({ host: 'localhost', search: '?diag=1', ls: { __RAW_DIAG__: '0' } }))).toBe(false);
    expect(isDiagHudEnabled(fakeWin({ host: 'app.example.com', search: '?diag=1', ls: { __RAW_DIAG__: '0' } }))).toBe(false);
  });

  it('explicit opt-ins work on production hosts', () => {
    expect(isDiagHudEnabled(fakeWin({ host: 'app.example.com', search: '?diag=1' }))).toBe(true);
    expect(isDiagHudEnabled(fakeWin({ host: 'app.example.com', ls: { __RAW_DIAG__: '1' } }))).toBe(true);
  });

  it('fails CLOSED: no window, or a throwing localStorage, renders nothing', () => {
    expect(isDiagHudEnabled(null)).toBe(false);
    expect(isDiagHudEnabled(undefined)).toBe(false);
    expect(isDiagHudEnabled(fakeWin({ host: 'localhost', lsThrows: true }))).toBe(false);
  });
});
