// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeedbackHost } from './FeedbackHost';
import { feedbackService } from './feedbackService';
import { Button, Modal } from '../components/ui';

it('stacks typed confirmation above a dialog and resolves queued decisions independently', async () => {
  const firstResult = vi.fn(),
    secondResult = vi.fn();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <FeedbackHost />
        <Button onClick={() => setOpen(true)}>Open settings</Button>
        <Modal open={open} title="Settings" onClose={() => setOpen(false)}>
          <Button
            onClick={() => {
              void feedbackService
                .confirm({
                  title: 'Delete resource',
                  message: 'Remove this resource?',
                  requiredText: 'Demo',
                  confirmVariant: 'danger',
                })
                .then(firstResult);
              void feedbackService
                .confirm({ title: 'Next decision', message: 'Continue?' })
                .then(secondResult);
            }}
          >
            Delete
          </Button>
        </Modal>
      </>
    );
  }
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  const opener = screen.getByRole('button', { name: 'Delete' });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Delete resource' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Demo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(firstResult).toHaveBeenCalledWith(true));
  expect(screen.getByRole('dialog', { name: 'Next decision' })).toBeInTheDocument();
  expect(secondResult).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(secondResult).toHaveBeenCalledWith(false));
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  await waitFor(() => expect(opener).toHaveFocus());
});

it('resolves pending confirmations as cancelled when the host unmounts', async () => {
  const { unmount } = render(<FeedbackHost />);
  let pending!: Promise<boolean>;
  act(() => {
    pending = feedbackService.confirm('Continue?');
  });
  unmount();
  await expect(pending).resolves.toBe(false);
});
