// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button, ChoiceGroup } from './index';

it('keeps one native form value and does not submit on selection', () => {
  const submit = vi.fn((event) => event.preventDefault());
  function Example() {
    const [value, setValue] = useState('confirmed');
    return (
      <form aria-label="Commit" onSubmit={submit}>
        <ChoiceGroup
          label="Scope"
          name="scope"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'confirmed', label: 'Confirmed only' },
            { value: 'all', label: 'All translations' },
            { value: 'locked', label: 'Unavailable', disabled: true },
          ]}
        />
        <Button type="submit">Commit</Button>
      </form>
    );
  }
  render(<Example />);
  expect(screen.getByRole('group', { name: 'Scope' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'All translations' }));
  expect(screen.getByRole('radio', { name: 'Confirmed only' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'All translations' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Unavailable' })).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
  expect(new FormData(screen.getByRole('form') as HTMLFormElement).getAll('scope')).toEqual([
    'all',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  expect(submit).toHaveBeenCalledOnce();
});
