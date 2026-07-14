import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LinkedFileButton } from './LinkedFileButton';

describe('LinkedFileButton', () => {
  it('opens the complete linked path when clicked', () => {
    const onOpen = vi.fn();
    const element = LinkedFileButton({
      filePath: 'D:\\references\\product-terms.xlsx',
      onOpen,
    }) as React.ReactElement<{ onClick: () => void }>;

    element.props.onClick();

    expect(onOpen).toHaveBeenCalledWith('D:\\references\\product-terms.xlsx');
  });
});
