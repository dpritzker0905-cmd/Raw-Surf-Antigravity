import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GearHub } from './GearHub';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
jest.mock('../utils/gromPurchase', () => ({ submitPurchaseRequest: jest.fn() }));
jest.mock('../utils/media', () => ({ getFullUrl: value => value }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: [] });
});

test.each([
  'Cameras', 'Lenses', 'Housings', 'Drones', 'Accessories',
  'Surfboards', 'Wetsuits', 'Surf Gear', 'All',
])('category button exposes its visible name: %s', async label => {
  render(<GearHub />);
  await screen.findByText('No gear found');

  const button = screen.getByText(label, { selector: 'button', exact: true });
  expect(button).toHaveAccessibleName(label);
  expect(screen.getByRole('button', { name: label, exact: true })).toBe(button);
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
});
