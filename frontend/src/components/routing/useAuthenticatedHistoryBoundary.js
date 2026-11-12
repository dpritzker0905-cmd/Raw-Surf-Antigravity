import {useEffect, useRef} from 'react';
import {useHref, useLocation, useNavigate} from 'react-router-dom';
import { clearMapWeatherRouteMemory } from '../map/mapWeatherRouteMemoryStore';
import {AUTHENTICATED_HISTORY_MARKER as MARKER} from './appHistory';

const AUTH_PATHS = new Set(['/', '/auth', '/login', '/auth/']);
const token = () => typeof window.crypto?.randomUUID === 'function'
  ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pathInRoot = (pathname, root) => !root ? pathname
  : pathname === root ? '/' : pathname.startsWith(`${root}/`) ? pathname.slice(root.length) : null;
const routeUrl = location => `${location.pathname}${location.search}${location.hash}`;

// One invisible entry protects the signed-in arrival boundary. Private POPs never push,
// so Back/Forward retain their branch. Metadata contains no credentials or forecast payloads;
// account id scopes the boundary across remounts without adding browser storage.
export default function useAuthenticatedHistoryBoundary(accountId) {
  const location = useLocation();
  const navigate = useNavigate();
  const rootHref = useHref('/');
  const root = new URL(rootHref, window.location.origin).pathname.replace(/\/$/, '');
  const latest = useRef(null);
  latest.current = {accountId, location, navigate, root};
  const manager = useRef(null);

  useEffect(() => {
    let active = null, pending = null, timer = null;
    const clearRecovery = () => { if (timer !== null) clearTimeout(timer); timer = null; pending = null; };
    const markerOf = state => {
      const value = state?.[MARKER], input = latest.current;
      return value?.version === 1 && value.account === input.accountId && value.root === input.root
        && typeof value.id === 'string' && ['boundary', 'entry', 'route'].includes(value.kind) ? value : null;
    };
    const writeMarker = kind => {
      window.history.replaceState({...window.history.state, [MARKER]: {...active, kind}}, '', window.location.href);
    };
    const seed = () => {
      clearRecovery();
      const input = latest.current;
      active = {version: 1, account: input.accountId, root: input.root, id: token(),
        startIndex: Number.isInteger(window.history.state?.idx) ? window.history.state.idx : 0};
      writeMarker('boundary');
      // The hidden boundary and visible copy are one logical router entry: preserve
      // its key, index and caller state, and keep the hidden POP away from the router.
      window.history.pushState({...window.history.state, [MARKER]: {...active, kind: 'entry'}}, '', window.location.href);
    };
    const recover = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (pending && active?.account === latest.current.accountId) window.history.forward();
      }, 0);
    };
    const sync = () => {
      const input = latest.current;
      if (!input.accountId) { active = null; clearRecovery(); return; }
      if (active?.account !== input.accountId || active.root !== input.root) {
        const saved = markerOf(window.history.state);
        if (saved && saved.kind !== 'boundary') active = {...saved};
        else seed();
      }
      const nativeRoute = pathInRoot(window.location.pathname, input.root);
      if (`${nativeRoute}${window.location.search}${window.location.hash}` !== routeUrl(input.location)) return;
      const saved = markerOf(window.history.state);
      if (saved?.id === active.id && saved.kind === 'boundary') return;
      if (pending && pending.key !== input.location.key) clearRecovery();
      if (saved?.id !== active.id) writeMarker('route');
    };
    const onPop = event => {
      const input = latest.current;
      if (!input.accountId) return;
      const destination = pathInRoot(window.location.pathname, input.root);
      if (AUTH_PATHS.has(destination)) {
        event.stopImmediatePropagation();
        clearRecovery();
        input.navigate('/feed', {replace: true});
        seed();
        return;
      }
      const saved = markerOf(event.state);
      if (saved?.id === active?.id && saved.kind === 'boundary') {
        event.stopImmediatePropagation();
        pending ||= {key: input.location.key, url: routeUrl(input.location)};
        recover();
        return;
      }
      if (pending) {
        if (saved?.id === active?.id && saved.kind !== 'boundary') {
          const sameRoute = pending.url === `${destination}${window.location.search}${window.location.hash}`
            && pending.key === (event.state?.key || 'default');
          clearRecovery();
          if (sameRoute) event.stopImmediatePropagation();
        } else {
          event.stopImmediatePropagation();
          recover();
        }
      }
    };
    manager.current = {sync};
    window.addEventListener('popstate', onPop, true);
    return () => {
      clearRecovery();
      window.removeEventListener('popstate', onPop, true);
      manager.current = null;
    };
  }, []);

  useEffect(() => {
    if (!accountId) clearMapWeatherRouteMemory();
    manager.current?.sync();
  }, [accountId, root, location]);
}
