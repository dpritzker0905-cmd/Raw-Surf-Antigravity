import React from 'react';
import { render, screen } from '@testing-library/react';
import ActiveSessionCard from './ActiveSessionCard';
import IncomingRequestCard from './IncomingRequestCard';

test.each([
  ['incoming request', IncomingRequestCard, 'request'],
  ['active session', ActiveSessionCard, 'session']
])('%s links the visible username to the requester profile ID', (_, Card, prop) => {
  const record = { requester_id: 'surfer-id', requester_username: 'surfer-handle' };
  render(<Card {...{ [prop]: record }} />);
  expect(screen.getByRole('link', { name: '@surfer-handle' }).getAttribute('href')).toBe('/profile/surfer-id');
});
