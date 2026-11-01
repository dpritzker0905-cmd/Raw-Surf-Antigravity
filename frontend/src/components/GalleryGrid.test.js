import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GalleryGridItem } from './GalleryGrid';

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

  test('bulk selection and absent callbacks preserve existing visibility and selection', () => {
    const callbacks = setup(theme, { bulkSelectMode: true });
    expect(screen.queryByRole('button', { name: 'Item actions' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`gallery-item-${item.id}`));
    expect(callbacks.onSelect).toHaveBeenCalledWith(item.id);
    expect(callbacks.onClick).not.toHaveBeenCalled();
  });

  test('read-only items retain detail activation without action controls', () => {
    const onClick = jest.fn();
    setup(theme, { onEdit: undefined, onDelete: undefined, onClick });
    expect(screen.queryByRole('button', { name: 'Item actions' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`gallery-item-${item.id}`));
    expect(onClick).toHaveBeenCalledWith(item);
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
