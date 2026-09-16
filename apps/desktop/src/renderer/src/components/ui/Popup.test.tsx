// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, MenuItem, Popover } from './Popup';
import { Modal } from './Modal';

describe('shared popups', () => {
  it('navigates enabled items, dismisses with Escape and restores the trigger', async () => {
    const action = vi.fn();
    const focus = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={anchor} onClick={() => setOpen(true)}>
            Actions
          </button>
          <Menu open={open} anchor={anchor} label="Actions menu" onClose={() => setOpen(false)}>
            <MenuItem onClick={action} onFocus={focus}>
              First
            </MenuItem>
            <MenuItem disabled>Unavailable</MenuItem>
            <MenuItem>Last</MenuItem>
          </Menu>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus());
    expect(focus).toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps a popup inside the modal boundary and closes only the popup on Escape', async () => {
    const close = vi.fn();
    function Example() {
      const [open, setOpen] = useState(false);
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <Modal open title="Options" onClose={close}>
          <button ref={anchor} onClick={() => setOpen(true)}>
            Filters
          </button>
          <Popover
            open={open}
            anchor={anchor}
            label="Filter options"
            onClose={() => setOpen(false)}
          >
            <input aria-label="Query" />
          </Popover>
        </Modal>
      );
    }
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const popup = await screen.findByRole('dialog', { name: 'Filter options' });
    expect(screen.getByRole('dialog', { name: 'Options' })).toContainElement(popup);
    await waitFor(() => expect(within(popup).getByRole('textbox')).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Filter options' })).toBeNull(),
    );
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
