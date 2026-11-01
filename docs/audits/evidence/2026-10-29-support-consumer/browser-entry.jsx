import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import NotificationsPage from '../../../../frontend/src/components/NotificationsPage';
import NotificationsDrawer from '../../../../frontend/src/components/NotificationsDrawer';
import { accountA, AuthProvider, ThemeProvider, fixture } from './browser-stubs';

const params = new URLSearchParams(window.location.search);
function ObserveLocation() {
  const location = useLocation();
  useEffect(() => {
    fixture.navigations.push({ pathname: location.pathname, key: location.key });
  }, [location]);
  return <output data-testid="location">{location.pathname}</output>;
}
function TicketDestination() {
  const { ticketId } = useParams();
  return <h1 data-testid="ticket-destination">Synthetic ticket route: {ticketId}</h1>;
}
function App() {
  const [owner, setOwner] = useState(accountA);
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    fixture.owner = owner; fixture.open = open; fixture.mounted = mounted;
    fixture.switchOwner = setOwner; fixture.setOpen = setOpen; fixture.setMounted = setMounted;
    fixture.ready = true;
  }, [owner, open, mounted]);
  const surface = params.get('surface') || 'page';
  return <AuthProvider value={{ user: owner ? { id: owner } : null }}>
    <ThemeProvider value={{ theme: params.get('theme') || 'dark' }}>
      <BrowserRouter>
        <ObserveLocation />
        <Routes>
          <Route path="/notifications" element={mounted && (surface === 'drawer'
            ? <NotificationsDrawer isOpen={open} onClose={() => { fixture.closes += 1; setOpen(false); }}
              onCountUpdate={() => { fixture.countUpdates += 1; }} />
            : <NotificationsPage />)} />
          <Route path="/support/tickets/:ticketId" element={<TicketDestination />} />
          <Route path="/post/:postId" element={<h1>Synthetic legacy destination</h1>} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ThemeProvider>
  </AuthProvider>;
}
const root = createRoot(document.getElementById('root'));
fixture.unmount = () => { if (!fixture.unmounted) { fixture.unmounted = true; root.unmount(); } };
fixture.settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
fixture.snapshot = () => ({
  owner: fixture.owner, open: fixture.open, mounted: fixture.mounted, closes: fixture.closes,
  countUpdates: fixture.countUpdates, badgeRefreshes: fixture.badgeRefreshes,
  navigations: fixture.navigations, requests: fixture.requests,
});
root.render(<App />);
