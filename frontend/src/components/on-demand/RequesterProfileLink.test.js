import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActiveSessionCard from './ActiveSessionCard';
import IncomingRequestCard from './IncomingRequestCard';

jest.mock('../../utils/media', () => ({ getFullUrl: url => url }));

test.each([
  ['active session', ActiveSessionCard, 'session'],
  ['incoming request', IncomingRequestCard, 'request'],
])('%s links the visible handle to the requester ID', (_, Card, prop) => {
  const requester = { requester_username: 'kai', requester_id: 'surfer-42' };
  const { rerender } = render(<Card {...{ [prop]: requester }} />);
  const link = screen.getByRole('link', { name: '@kai' });
  expect(link).toHaveAttribute('href', '/profile/surfer-42');
  expect(link).toHaveAttribute('target', '_blank');
  rerender(<Card {...{ [prop]: { requester_username: 'kai' } }} />);
  expect(screen.queryByRole('link', { name: '@kai' })).not.toBeInTheDocument();
  expect(screen.getByText('@kai')).toBeVisible();
});
