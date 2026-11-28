import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommentItem } from './PostModalComponents';

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../RichText', () => ({ CommentText: ({ text }) => text }));
jest.mock('../EmojiPicker', () => () => null);
jest.mock('../messages/GifPicker', () => () => null);
jest.mock('../../lib/apiClient', () => ({}));

test('one Reply activation focuses the nested draft and typing survives attachment load', () => {
  const onReply = jest.fn();
  render(<CommentItem comment={{ id: 'parent', content: 'Photo', author_name: 'QA',
    media_url: '/photo.jpg', created_at: new Date().toISOString() }} onReply={onReply} />);
  const reply = screen.getByRole('button', { name: 'Reply' });
  fireEvent.click(reply);
  const input = screen.getByRole('textbox');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'draft' } });
  fireEvent.load(screen.getByAltText('Comment attachment'));
  expect(reply.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('draft');
  expect(onReply).not.toHaveBeenCalled();
});
