import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileBlockModal } from './ProfileBlockModal';

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
