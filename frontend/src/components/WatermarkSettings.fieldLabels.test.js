import React from 'react';
import { render, screen } from '@testing-library/react';
import WatermarkSettings from './WatermarkSettings';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: { watermark_style: 'text' } }) }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test.each([
  ['Watermark Text', 'textbox'],
  ['Position', 'combobox'],
])('%s is the accessible name of its associated control', async (name, role) => {
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  await screen.findByText(name, { selector: 'label' });
  const control = screen.getByRole(role, { name });
  expect(screen.getByLabelText(name)).toBe(control);
});
