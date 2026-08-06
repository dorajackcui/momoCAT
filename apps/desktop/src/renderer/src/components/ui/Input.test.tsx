// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  test('applies default field class', () => {
    render(<Input aria-label="name" />);
    const input = screen.getByLabelText('name');
    expect(input).toHaveClass('field-input');
  });

  test('applies tone class', () => {
    render(<Input aria-label="temp" tone="danger" />);
    const input = screen.getByLabelText('temp');
    expect(input).toHaveClass('field-input-danger');
  });
});
