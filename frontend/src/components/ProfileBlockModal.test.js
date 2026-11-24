import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileBlockModal } from './ProfileBlockModal';
import { useProfileBlock } from '../hooks/useProfileBlock';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ post: jest.fn() }));

function BlockDialog({ onBlock = jest.fn(), blockLoading = false }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <ProfileBlockModal isOpen onClose={jest.fn()} profileName="Ari"
      blockReason={reason} setBlockReason={setReason}
      blockNotes={notes} setBlockNotes={setNotes}
      blockLoading={blockLoading} onBlock={onBlock} />
  );
}

test('the visible confirmation name identifies the button for keyboard activation', async () => {
  const user = userEvent.setup();
  const onBlock = jest.fn();
  render(<BlockDialog onBlock={onBlock} />);
  const dialog = screen.getByRole('dialog', { name: 'Block Ari?' });
  const confirm = within(dialog).getByRole('button', { name: 'Block User' });
  confirm.focus();
  await user.keyboard('{Enter}');
  expect(onBlock).toHaveBeenCalledTimes(1);
});

test('the confirmation keeps its action name and is disabled while blocking', () => {
  render(<BlockDialog blockLoading />);
  expect(screen.getByRole('button', { name: 'Block User' })).toBeDisabled();
});

test('the optional field labels identify the inputs and report consequences update with the reason', async () => {
  const user = userEvent.setup();
  const onBlock = jest.fn();
  render(<BlockDialog onBlock={onBlock} />);
  const reason = screen.getByRole('combobox', { name: 'Reason (optional)' });
  const notes = screen.getByRole('textbox', { name: 'Additional notes (private, optional)' });
  const notice = screen.getByRole('status');
  expect(notice).toBeEmptyDOMElement();
  await user.selectOptions(reason, 'harassment');
  expect(notice).toHaveTextContent(/also report the user/i);
  await user.selectOptions(reason, 'spam');
  expect(notice).toBeEmptyDOMElement();
  await user.selectOptions(reason, 'scam');
  expect(notice).toHaveTextContent(/also report the user/i);
  await user.type(notes, 'Private note');
  expect(notes).toHaveValue('Private note');
  expect(onBlock).not.toHaveBeenCalled();
});

function ProfileBlockFlow({ profileId }) {
  const block = useProfileBlock('viewer', profileId, false);
  return (
    <>
      <button onClick={() => block.setShowBlockModal(true)}>Open block dialog</button>
      <ProfileBlockModal isOpen={block.showBlockModal} onClose={block.setShowBlockModal}
        profileName={profileId} blockReason={block.blockReason} setBlockReason={block.setBlockReason}
        blockNotes={block.blockNotes} setBlockNotes={block.setBlockNotes}
        blockLoading={block.blockLoading} onBlock={() => block.handleBlockUser(profileId)} />
    </>
  );
}

test.each([
  ['Escape', user => user.keyboard('{Escape}')],
  ['the close button', user => user.click(screen.getByRole('button', { name: 'Close' }))],
  ['an outside press', () => fireEvent.pointerDown(document.body, { button: 0 })],
  ['Cancel', user => user.click(screen.getByRole('button', { name: 'Cancel' }))],
])('dismissal with %s discards private notes and the report reason', async (_, dismiss) => {
  const user = userEvent.setup();
  apiClient.post.mockReset().mockResolvedValue({});
  const { rerender } = render(<ProfileBlockFlow profileId="Ari" />);
  await user.click(screen.getByRole('button', { name: 'Open block dialog' }));
  await user.selectOptions(screen.getByRole('combobox'), 'scam');
  await user.type(screen.getByRole('textbox'), 'Private note about Ari');
  expect(screen.getByRole('status')).toHaveTextContent(/also report/i);
  await dismiss(user);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();

  rerender(<ProfileBlockFlow profileId="Kai" />);
  await user.click(screen.getByRole('button', { name: 'Open block dialog' }));
  const next = within(screen.getByRole('dialog', { name: 'Block Kai?' }));
  expect([next.getByRole('combobox').value, next.getByRole('textbox').value]).toEqual(['', '']);
  expect(next.getByRole('status')).toBeEmptyDOMElement();
  await user.click(next.getByRole('button', { name: 'Block User' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/users/block', {
    blocker_id: 'viewer', blocked_id: 'Kai', reason: null, notes: null, auto_report: false,
  });
});

test('a failed block keeps the draft for an intentional retry', async () => {
  const user = userEvent.setup();
  apiClient.post.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
  render(<ProfileBlockFlow profileId="Ari" />);
  await user.click(screen.getByRole('button', { name: 'Open block dialog' }));
  await user.selectOptions(screen.getByRole('combobox'), 'harassment');
  await user.type(screen.getByRole('textbox'), 'Context for Ari');
  const confirm = screen.getByRole('button', { name: 'Block User' });
  await user.click(confirm);
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(screen.getByRole('textbox')).toHaveValue('Context for Ari');
  expect(screen.getByRole('combobox')).toHaveValue('harassment');
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(apiClient.post).toHaveBeenLastCalledWith('/users/block', {
    blocker_id: 'viewer', blocked_id: 'Ari', reason: 'harassment', notes: 'Context for Ari', auto_report: true,
  });
});
