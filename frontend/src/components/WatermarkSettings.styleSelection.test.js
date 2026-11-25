import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WatermarkSettings from './WatermarkSettings';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: async () => ({ data: { watermark_style: 'logo' } }) }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test('only the active watermark style is pressed on load and after keyboard selection', async () => {
  const user = userEvent.setup();
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  await screen.findByTestId('logo-upload-input');
  const styles = ['Text Only', 'Logo Only', 'Logo + Text'];
  const assertSelection = selected => {
    for (const name of styles) {
      expect(screen.getByRole('button', { name, pressed: name === selected })).toBeVisible();
    }
  };

  assertSelection('Logo Only');
  const text = screen.getByRole('button', { name: 'Text Only' });
  text.focus();
  await user.keyboard('{Enter}');
  assertSelection('Text Only');
  await user.tab();
  await user.tab();
  await user.keyboard(' ');
  assertSelection('Logo + Text');
  await user.keyboard(' ');
  assertSelection('Logo + Text');
});
