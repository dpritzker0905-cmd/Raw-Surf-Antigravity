/**
 * A random install id for surf observations (T1 P2). The server stores only its hash and uses it to cap XP per
 * device ACROSS accounts and to require that corroboration comes from a different phone. It is not tied to the
 * account and deliberately survives sign-out (that is its job). It carries no hardware or personal information.
 * If storage is unavailable, a per-session id is used: those observations still count as truth, and the server
 * simply cannot pay XP across reloads for them beyond its other caps.
 */
const KEY = 'raw-surf-observer-device';
let sessionId = null;

function freshId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function observerDeviceId() {
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && /^[0-9a-fA-F-]{32,36}$/.test(existing)) return existing;
    const id = freshId();
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    if (!sessionId) sessionId = freshId();
    return sessionId;
  }
}
