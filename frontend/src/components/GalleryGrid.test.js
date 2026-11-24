import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { GalleryGrid, GalleryGridItem } from './GalleryGrid';

jest.mock('../utils/media', () => ({ getFullUrl: value => value, getOptimizedMediaUrl: () => null }));

const item = { id: 'synthetic-photo', title: 'Synthetic photo' };
const setup = (theme, extra = {}) => {
  const callbacks = { onClick: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn(), onSelect: jest.fn() };
  render(<div className={theme}><GalleryGridItem item={item} {...callbacks} {...extra} /></div>);
  return callbacks;
};

describe.each(['light', 'dark', 'beach'])('Gallery item actions in %s', theme => {
  test('names actions, hides decorative icons, and preserves callback arguments', () => {
    const callbacks = setup(theme);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const edit = screen.getByRole('button', { name: 'Edit', exact: true });
    expect(edit.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(edit);
    expect(callbacks.onEdit).toHaveBeenCalledWith(item);
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const remove = screen.getByRole('button', { name: 'Delete', exact: true });
    expect(remove.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(remove);
    expect(callbacks.onDelete).toHaveBeenCalledWith(item.id);
    expect(callbacks.onClick).not.toHaveBeenCalled();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  test('focuses an action, dismisses with Escape and returns focus for reopening', () => {
    const callbacks = setup(theme);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    trigger.focus();
    fireEvent.click(trigger);
    const edit = screen.getByRole('button', { name: 'Edit', exact: true });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Edit', exact: true })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    expect(callbacks.onEdit).not.toHaveBeenCalled();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  test('outside dismissal and trigger toggling never open the item', () => {
    const callbacks = setup(theme);
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    fireEvent.click(trigger);
    fireEvent.click(document.querySelector('.fixed.inset-0'));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('button', { name: 'Edit', exact: true })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    expect(callbacks.onClick).not.toHaveBeenCalled();
  });

  test('disabled deletion remains inert and Escape works without an enabled action', () => {
    const onDelete = jest.fn();
    setup(theme, { onEdit: undefined, onDelete, isDeleting: true });
    const trigger = screen.getByRole('button', { name: 'Item actions' });
    fireEvent.click(trigger);
    const remove = screen.getByRole('button', { name: 'Delete', exact: true });
    expect(remove).toBeDisabled();
    fireEvent.click(remove);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(remove).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('bulk toggles identify the item and expose its current selection', () => {
    const onItemSelect = jest.fn();
    const onItemClick = jest.fn();
    const items = [item, { id: 'untitled-video', media_type: 'video' }];
    const props = { items, bulkSelectMode: true, onItemSelect, onItemClick, theme };
    const { rerender } = render(<GalleryGrid {...props} />);
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Item actions' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Select Synthetic photo', pressed: false });
    fireEvent.click(toggle);
    expect(onItemSelect).toHaveBeenCalledTimes(1);
    expect(onItemSelect).toHaveBeenCalledWith(item.id);
    rerender(<GalleryGrid {...props} selectedItems={new Set([item.id])} />);
    expect(screen.getByRole('button', { name: 'Select Synthetic photo', pressed: true })).toBe(toggle);
    expect(screen.getByRole('button', { name: 'Select video 2', pressed: false })).toBeVisible();
    fireEvent.click(screen.getByTestId(`gallery-item-${item.id}`));
    expect(onItemSelect).toHaveBeenCalledTimes(2);
    expect(onItemSelect).toHaveBeenLastCalledWith(item.id);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  test('read-only items open by keyboard and pointer', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    setup(theme, { onEdit: undefined, onDelete: undefined, onClick });
    expect(screen.queryByRole('button', { name: 'Item actions' })).not.toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open Synthetic photo' });
    await user.tab();
    expect(open).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
    await user.click(open);
    expect(onClick.mock.calls).toEqual([[item], [item], [item]]);
  });

  test('delete-only action receives focus and unmount removes Escape handling', () => {
    const { unmount } = render(<GalleryGridItem item={item} onDelete={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Item actions' }));
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toHaveFocus();
    unmount();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
