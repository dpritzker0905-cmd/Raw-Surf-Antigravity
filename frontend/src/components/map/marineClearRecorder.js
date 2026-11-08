// OPT-IN SELF-CAPTURE for the intermittent "map/animation clears" report (2026-11-08 soak: 32 min, 12 lanes, no repro).
// Records a ring buffer of marine log lines and watches the clear count and __MARINE_DRAWN__; on a trigger it stores a
// snapshot in window.__SOAK_EVENTS__ and localStorage (10 max). OFF unless ?diag=1 or window.__RAW_SOAK_RECORDER__ === true.
// Kill: window.__RAW_DISABLE_SOAK_RECORDER__ = true. It changes no served number and draws nothing by itself.
const LINE_RX = /WebGLMarineEngine-Clear|Render backstop|Clamp backstop|No-downgrade|land mask|recordClear|non_renderable/;
export const SOAK_MAX_EVENTS = 10;
export const SOAK_BUFFER_MAX = 300;
const STORE_KEY = '__RAW_SOAK_EVENTS__';

export function isSoakRecorderEnabled(win) {
  if (!win || win.__RAW_DISABLE_SOAK_RECORDER__ === true) return false;
  if (win.__RAW_SOAK_RECORDER__ === true) return true;
  try { return new URLSearchParams(win.location.search).get('diag') === '1'; } catch (e) { return false; }
}

// Returns an uninstall function, or a no-op when disabled. onEvent(event) fires after each stored trigger.
export function installMarineClearRecorder(win, onEvent) {
  if (!isSoakRecorderEnabled(win)) return () => {};
  if (win.__SOAK_RECORDER_INSTALLED__) return () => {};
  win.__SOAK_RECORDER_INSTALLED__ = true;
  const buf = [];
  win.__SOAK_EVENTS__ = win.__SOAK_EVENTS__ || [];
  const orig = {};
  ['log', 'warn'].forEach((k) => {
    orig[k] = win.console[k];
    win.console[k] = function (...a) {
      try {
        const s = a.map((x) => (typeof x === 'string' ? x : '')).join(' ');
        if (LINE_RX.test(s)) { buf.push([Date.now(), k, s.slice(0, 300)]); if (buf.length > SOAK_BUFFER_MAX) buf.shift(); }
      } catch (e) { /* recorder never breaks logging */ }
      return orig[k].apply(this, a);
    };
  });
  let lastClear = win.__WEBGL_MARINE_CLEAR_COUNT__ || 0;
  let hadDrawn = !!win.__MARINE_DRAWN__;
  const snapshot = (why) => {
    let trace = null;
    try { const t = win.__MARINE_TRUTH_TRACE__; trace = JSON.stringify(Array.isArray(t) ? t.slice(-2) : t).slice(0, 800); } catch (e) { trace = null; }
    const ev = { t: Date.now(), why, href: win.location && win.location.href, vp: `${win.innerWidth}x${win.innerHeight}@${win.devicePixelRatio}`, buf: buf.slice(-20), trace };
    win.__SOAK_EVENTS__.push(ev);
    while (win.__SOAK_EVENTS__.length > SOAK_MAX_EVENTS) win.__SOAK_EVENTS__.shift();
    try { win.localStorage.setItem(STORE_KEY, JSON.stringify(win.__SOAK_EVENTS__)); } catch (e) { /* storage may be blocked */ }
    if (onEvent) { try { onEvent(ev); } catch (e) { /* ui only */ } }
  };
  const id = win.setInterval(() => {
    const c = win.__WEBGL_MARINE_CLEAR_COUNT__ || 0;
    const drawn = !!win.__MARINE_DRAWN__;
    if (c > lastClear) snapshot(`clear+${c - lastClear}`);
    else if (hadDrawn && !drawn) snapshot('drawn_null');
    lastClear = c; hadDrawn = drawn;
  }, 250);
  return () => {
    win.clearInterval(id);
    ['log', 'warn'].forEach((k) => { win.console[k] = orig[k]; });
    win.__SOAK_RECORDER_INSTALLED__ = false;
  };
}
