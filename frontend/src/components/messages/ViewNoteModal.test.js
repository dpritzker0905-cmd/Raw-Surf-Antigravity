import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from 'sonner';
import ViewNoteModal from './ViewNoteModal';
import useMessagesActions from '../../hooks/useMessagesActions';
import apiClient from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

function mount() {
  const navigate = jest.fn();
  const close = jest.fn();
  function Harness({ id, viewer, open }) {
    const { replyToNote } = useMessagesActions({ user: { id: viewer }, navigate });
    return <ViewNoteModal isOpen={open} currentUserId={viewer} onClose={close} onReply={replyToNote}
      onOpenConversation={cid => navigate(`/messages/${cid}`)}
      note={{ id, user_id: `author-${id}`, user_name: `Author ${id}`, content: `Note ${id}` }} />;
  }
  const view = (id, viewer = 'reader', open = true) => <Harness {...{ id, viewer, open }} />;
  const ui = render(view('a'));
  return { navigate, close, change: (...args) => ui.rerender(view(...args)) };
}

const input = () => screen.getByRole('textbox');
const type = text => fireEvent.change(input(), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }));
let resolveReply;
let rejectReply;
beforeEach(() => {
  jest.clearAllMocks();
  apiClient.post.mockImplementation(() => new Promise((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  }));
});

test('a draft stays with its open note and viewer through normal rerenders', () => {
  const ui = mount();
  type('Only for A');
  ui.change('a');
  expect(input()).toHaveValue('Only for A');
  ui.change('b');
  expect(input()).toHaveValue('');
  type('Only from reader');
  ui.change('b', 'another-reader');
  expect(input()).toHaveValue('');
  type('Dismissed draft');
  ui.change('b', 'another-reader', false);
  ui.change('b', 'another-reader');
  expect(input()).toHaveValue('');
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('a delayed success cannot close a new note or open the old conversation', async () => {
  const ui = mount();
  type('For A');
  send();
  ui.change('b');
  type('For B');
  await act(async () => resolveReply({ data: { conversation_id: 'old-conversation' } }));
  expect(ui.navigate).not.toHaveBeenCalled();
  expect(ui.close).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(input()).toHaveValue('For B');
  expect(apiClient.post.mock.calls).toEqual([['/notes/a/reply', { reply_text: 'For A' }]]);
});

test('reopening the same note after dismissal ignores a late failure', async () => {
  const ui = mount();
  type('First reply');
  send();
  ui.change('a', 'reader', false);
  ui.change('a');
  type('New draft');
  await act(async () => rejectReply(new Error('Fixture read failed')));
  expect(toast.error).not.toHaveBeenCalled();
  expect(input()).toHaveValue('New draft');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a current failure keeps the draft and an explicit retry opens the confirmed conversation once', async () => {
  const ui = mount();
  type(' Hello ');
  send();
  await act(async () => rejectReply(new Error('Fixture offline')));
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(input()).toHaveValue(' Hello ');
  expect(ui.close).not.toHaveBeenCalled();
  send();
  send();
  await act(async () => resolveReply({ data: { conversation_id: 'confirmed' } }));
  expect(apiClient.post.mock.calls).toEqual(Array(2).fill(['/notes/a/reply', { reply_text: 'Hello' }]));
  expect(ui.navigate.mock.calls).toEqual([['/messages/confirmed']]);
  expect(ui.close).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledTimes(1);
});

test('a late response from a previous viewer leaves the current send in progress', async () => {
  const ui = mount();
  type('First account');
  send();
  const finishFirst = resolveReply;

  ui.change('a', 'second-reader');
  type('Second account');
  send();
  await act(async () => finishFirst({ data: { conversation_id: 'first' } }));
  expect(input()).toBeDisabled();
  expect(input()).toHaveValue('Second account');
  expect(ui.close).not.toHaveBeenCalled();
  expect(ui.navigate).not.toHaveBeenCalled();

  await act(async () => resolveReply({ data: { conversation_id: 'second' } }));
  expect(ui.navigate.mock.calls).toEqual([['/messages/second']]);
  expect(ui.close).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
