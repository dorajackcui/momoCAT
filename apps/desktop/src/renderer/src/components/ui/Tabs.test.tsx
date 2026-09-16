// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Tabs, TabsList, TabsPanel } from './Tabs';

it('connects tab and panel semantics and supports arrows, Home and End', async () => {
  render(
    <Tabs defaultValue="one">
      <TabsList
        label="Sections"
        items={[
          { value: 'one', label: 'One' },
          { value: 'disabled', label: 'Disabled', disabled: true },
          { value: 'two', label: 'Two' },
        ]}
      />
      <TabsPanel value="one">First section</TabsPanel>
      <TabsPanel value="two">Second section</TabsPanel>
    </Tabs>,
  );
  const first = screen.getByRole('tab', { name: 'One' }),
    last = screen.getByRole('tab', { name: 'Two' });
  expect(first).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  await waitFor(() => expect(last).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Second section');
  fireEvent.keyDown(last, { key: 'Home' });
  await waitFor(() => expect(first).toHaveFocus());
  fireEvent.keyDown(first, { key: 'End' });
  await waitFor(() => expect(last).toHaveFocus());
});
