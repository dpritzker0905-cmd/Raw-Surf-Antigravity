import React from 'react';
import ProtectedRoute from '../routing/ProtectedRoute';
import AppLayout from '../routing/AppLayout';
import SupportInbox from './SupportInbox';

// Mount at /support and /support/tickets/:ticketId in the router owner's integration.
export default function SupportRoute() {
  return <ProtectedRoute bypassGromGate><AppLayout><SupportInbox /></AppLayout></ProtectedRoute>;
}
