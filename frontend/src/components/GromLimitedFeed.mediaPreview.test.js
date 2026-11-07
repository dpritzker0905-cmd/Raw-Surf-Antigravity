import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import GromLimitedFeed from './GromLimitedFeed';

let mockTheme = 'light';
const mockPreviewGet = jest.fn();
const mockWrite = jest.fn();
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-grom', role: 'GROM' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockPreviewGet(...args),
  post: (...args) => mockWrite(...args),
  put: (...args) => mockWrite(...args),
  patch: (...args) => mockWrite(...args),
  delete: (...args) => mockWrite(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('./grom/AskMyParentPanel', () => () => <button type="button">Get a code</button>);

const videoUrl = 'https://media.example.invalid/fictional-video.mp4';
const imageUrl = 'https://media.example.invalid/fictional-photo.jpg';
const thumbnailUrl = 'https://media.example.invalid/fictional-thumbnail.jpg';

beforeEach(() => {
  mockPreviewGet.mockReset();
  mockWrite.mockReset();
});

async function preview(media) {
  mockPreviewGet.mockResolvedValue({ data: [{
    id: 'fictional-post', author_name: 'Fictional Grom', caption: 'A fictional surf day',
    likes_count: 4, comments_count: 0, ...media,
  }] });
  const view = render(<GromLimitedFeed gromStatus={{ guardian_level: 'L0' }} />);
  await screen.findByText('A fictional surf day');
  return view;
}

function expectLimitedReadOnlyPreview(container) {
  expect(mockPreviewGet.mock.calls).toEqual([['/posts/grom-preview?limit=3']]);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(screen.getByText('Parent Link Required')).toBeVisible();
  expect(screen.getByText('Features locked until parent approval:')).toBeVisible();
  expect(screen.getByText('1 POST')).toBeVisible();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled();
  expect(container.querySelector('video, audio, source')).toBeNull();
}

describe.each(['light', 'dark', 'beach'])('%s limited media preview', theme => {
  beforeEach(() => { mockTheme = theme; });

  test.each([null, undefined, ''])('video with absent thumbnail %p has a passive fallback', async thumbnail => {
    const { container } = await preview({ media_type: 'video', media_url: videoUrl, thumbnail_url: thumbnail });
    const fallback = screen.getByText('Video preview unavailable');
    expect(fallback).toBeVisible();
    expect(fallback).toHaveClass(theme === 'light' ? 'bg-gray-100' : 'bg-zinc-800');
    expect(fallback).toHaveClass(theme === 'light' ? 'text-gray-600' : 'text-gray-400');
    expect(fallback.closest('.aspect-square')).not.toBeNull();
    expect(fallback.closest('button, a, input, select, textarea, [tabindex]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expectLimitedReadOnlyPreview(container);
  });

  test('video with a real thumbnail keeps the existing image preview', async () => {
    const { container } = await preview({ media_type: 'video', media_url: videoUrl, thumbnail_url: thumbnailUrl });
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', thumbnailUrl);
    expect(image).toHaveClass('w-full', 'h-full', 'object-cover');
    expect(image.closest('.aspect-square')).not.toBeNull();
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });

  test('thumbnail-only video retains its existing preview', async () => {
    const { container } = await preview({ media_type: 'video', media_url: null, thumbnail_url: thumbnailUrl });
    expect(container.querySelector('img')).toHaveAttribute('src', thumbnailUrl);
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });

  test('ordinary image retains its media URL', async () => {
    const { container } = await preview({ media_type: 'image', media_url: imageUrl, thumbnail_url: null });
    expect(container.querySelector('img')).toHaveAttribute('src', imageUrl);
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });

  test('image with a thumbnail retains thumbnail precedence', async () => {
    const { container } = await preview({ media_type: 'image', media_url: imageUrl, thumbnail_url: thumbnailUrl });
    expect(container.querySelector('img')).toHaveAttribute('src', thumbnailUrl);
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });

  test('legacy media with no declared type retains its existing image behavior', async () => {
    const { container } = await preview({ media_url: imageUrl });
    expect(container.querySelector('img')).toHaveAttribute('src', imageUrl);
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });

  test('a post with no media retains the absent media box', async () => {
    const { container } = await preview({ media_type: 'video', media_url: null, thumbnail_url: null });
    expect(container.querySelector('img, .aspect-square')).toBeNull();
    expect(screen.queryByText('Video preview unavailable')).not.toBeInTheDocument();
    expectLimitedReadOnlyPreview(container);
  });
});
