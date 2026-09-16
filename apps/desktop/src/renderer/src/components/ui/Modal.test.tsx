// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders only while open, names the dialog and portals outside clipping containers', () => {
    const { container, rerender } = render(
      <Modal open={false} title="Options">
        Body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <Modal open title="Options" description="Configure this file">
        Body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Options' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Configure this file');
    expect(container).not.toContainElement(dialog);
  });

  it('traps focus, closes with Escape and restores the opener after child autofocus', async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <Modal open={open} title="Edit" onClose={() => setOpen(false)}>
            <Input autoFocus aria-label="Name" />
            <button>Last</button>
          </Modal>
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    opener.focus();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('dismisses from the backdrop only when enabled and never dismisses a blocking job', async () => {
    const close = vi.fn();
    const { rerender } = render(
      <Modal open title="Edit" onClose={close}>
        Body
      </Modal>,
    );
    // Radix installs outside-pointer handling after the opening event has finished.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.querySelector('.modal-backdrop')!, {
      pointerType: 'mouse',
      button: 0,
    });
    expect(close).toHaveBeenCalledOnce();
    close.mockClear();
    rerender(
      <Modal open title="Edit" onClose={close} closeOnBackdrop={false}>
        Body
      </Modal>,
    );
    fireEvent.pointerDown(document.querySelector('.modal-backdrop')!, {
      pointerType: 'mouse',
      button: 0,
    });
    expect(close).not.toHaveBeenCalled();
    rerender(
      <Modal open title="Importing">
        Progress
      </Modal>,
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.pointerDown(document.querySelector('.modal-backdrop')!, {
      pointerType: 'mouse',
      button: 0,
    });
    expect(screen.getByRole('dialog', { name: 'Importing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('only dismisses the top dialog and returns focus to the underlying dialog', async () => {
    const parentClose = vi.fn();
    function Example() {
      const [confirm, setConfirm] = useState(false);
      return (
        <>
          <Modal open title="Parent" onClose={parentClose}>
            <button onClick={() => setConfirm(true)}>Delete</button>
          </Modal>
          <Modal open={confirm} title="Confirm" onClose={() => setConfirm(false)}>
            <Input autoFocus aria-label="Confirm name" />
          </Modal>
        </>
      );
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(parentClose).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
  });
});
