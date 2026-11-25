import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WatermarkSettings from './WatermarkSettings';
import apiClient from '../lib/apiClient';

jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'photographer' } }) }));
jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('./ui/slider', () => ({ Slider: () => null }));

test.each(['logo', 'both'])('the native logo picker is reachable and uploads the selected file in %s mode', async style => {
  apiClient.get.mockResolvedValue({ data: { watermark_style: style } });
  apiClient.post.mockReset().mockResolvedValue({ data: { url: '/fixture.png' } });
  const user = userEvent.setup();
  render(<WatermarkSettings open onOpenChange={jest.fn()} />);
  const picker = await screen.findByLabelText('Upload Logo', { selector: 'input' });
  // JSDOM does not load Tailwind's stylesheet. Guard the utility that keeps the input focusable.
  expect(picker).toHaveClass('sr-only');
  expect(picker).not.toHaveClass('hidden');
  const previous = style === 'logo' ? screen.getByRole('button', { name: 'Logo + Text' }) : screen.getByTestId('watermark-text-input');
  previous.focus();
  await user.tab();
  expect(picker).toHaveFocus();
  const file = new File(['fixture'], 'logo.png', { type: 'image/png' });
  await user.upload(picker, file);
  expect(await screen.findByRole('img', { name: 'Watermark logo' })).toHaveAttribute('src', '/fixture.png');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  const [url, body] = apiClient.post.mock.calls[0];
  expect(url).toBe('/upload/image');
  expect(body.get('file')).toBe(file);
  expect(body.get('upload_type')).toBe('watermark_logo');
  await user.click(screen.getByRole('button', { name: 'Remove watermark logo' }));
  expect(screen.getByLabelText('Upload Logo', { selector: 'input' })).toBeInTheDocument();
});
