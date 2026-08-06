// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  test('renders primary variant by default', () => {
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('btn-primary');
  });

  test('shows spinner when loading', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button.querySelector('.animate-spin')).not.toBeNull();
  });

  test('handles click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
