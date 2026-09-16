// @vitest-environment jsdom
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button, Checkbox, IconButton, Input, Radio, Select, Textarea } from './index';

it('preserves native form values, refs, disabled behavior and explicit submission', () => {
  const submit = vi.fn((event) => event.preventDefault());
  const ref = createRef<HTMLInputElement>();
  render(
    <form onSubmit={submit}>
      <Input name="name" aria-label="Name" ref={ref} defaultValue="Demo" />
      <Select name="locale" aria-label="Locale" defaultValue="en">
        <option value="en">English</option>
        <option value="zh">Chinese</option>
      </Select>
      <Textarea name="note" aria-label="Note" defaultValue="Notes" />
      <Checkbox name="enabled" aria-label="Enabled" defaultChecked />
      <Radio name="mode" value="local" aria-label="Local" defaultChecked />
      <Button>Secondary action</Button>
      <IconButton aria-label="Icon action" />
      <Button type="submit">Save</Button>
      <Button type="submit" loading>
        Saving
      </Button>
    </form>,
  );
  expect(ref.current).toBe(screen.getByLabelText('Name'));
  ref.current?.focus();
  expect(ref.current).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Secondary action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Icon action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving' }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Locale'), { target: { value: 'zh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledOnce();
  expect(Object.fromEntries(new FormData(ref.current!.form!))).toEqual({
    name: 'Demo',
    locale: 'zh',
    note: 'Notes',
    enabled: 'on',
    mode: 'local',
  });
});
