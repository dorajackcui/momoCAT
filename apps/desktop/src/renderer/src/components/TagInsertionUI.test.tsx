import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagInsertionUI } from './TagInsertionUI';
import type { Token } from '@cat/core/models';

describe('TagInsertionUI', () => {
  const mockSourceTags: Token[] = [
    { type: 'tag', content: '<bold>', meta: { id: '<bold>' } },
    { type: 'tag', content: '</bold>', meta: { id: '</bold>' } },
    { type: 'tag', content: '{1}', meta: { id: '{1}' } },
  ];

  const mockOnInsertTag = jest.fn();
  const mockOnInsertAllTags = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Visibility', () => {
    test('renders when isVisible is true and tags are available', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(screen.getByText('Insert All Tags')).toBeInTheDocument();
    });

    test('does not render when isVisible is false', () => {
      const { container } = render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={false}
        />,
      );

      expect(container.firstChild).toBeNull();
    });

    test('does not render when sourceTags is empty', () => {
      const { container } = render(
        <TagInsertionUI
          sourceTags={[]}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Tag List Rendering', () => {
    test('renders all source tags in the list', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      // Check that all tags are displayed
      expect(screen.getByText('<bold>')).toBeInTheDocument();
      expect(screen.getByText('</bold>')).toBeInTheDocument();
      expect(screen.getByText('{1}')).toBeInTheDocument();
    });

    test('displays tag preview capsules with correct format', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      // Check for display format in capsules
      expect(screen.getByText('[1')).toBeInTheDocument(); // paired-start
      expect(screen.getByText('2]')).toBeInTheDocument(); // paired-end
      expect(screen.getByText('⟨1⟩')).toBeInTheDocument(); // standalone
    });
  });

  describe('Insert All Tags Button', () => {
    test('renders "Insert All Tags" button', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      const insertAllButton = screen.getByText('Insert All Tags');
      expect(insertAllButton).toBeInTheDocument();
      expect(insertAllButton).toHaveAttribute('role', 'menuitem');
    });

    test('calls onInsertAllTags when "Insert All Tags" is clicked', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      const insertAllButton = screen.getByText('Insert All Tags');
      fireEvent.click(insertAllButton);

      expect(mockOnInsertAllTags).toHaveBeenCalledTimes(1);
      expect(mockOnInsertTag).not.toHaveBeenCalled();
    });
  });

  describe('Individual Tag Insertion', () => {
    test('calls onInsertTag with correct index when a tag is clicked', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      // Click the first tag
      const firstTagButton = screen.getByLabelText('Insert tag 1: <bold>');
      fireEvent.click(firstTagButton);

      expect(mockOnInsertTag).toHaveBeenCalledTimes(1);
      expect(mockOnInsertTag).toHaveBeenCalledWith(0);
    });

    test('calls onInsertTag with correct index for different tags', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      // Click the third tag
      const thirdTagButton = screen.getByLabelText('Insert tag 3: {1}');
      fireEvent.click(thirdTagButton);

      expect(mockOnInsertTag).toHaveBeenCalledTimes(1);
      expect(mockOnInsertTag).toHaveBeenCalledWith(2);
    });
  });

  describe('Accessibility', () => {
    test('has proper ARIA attributes', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      const menu = screen.getByRole('menu');
      expect(menu).toHaveAttribute('aria-label', 'Tag insertion menu');

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems.length).toBe(4); // 1 "Insert All" + 3 individual tags
    });

    test('tag buttons have descriptive aria-labels', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      expect(screen.getByLabelText('Insert tag 1: <bold>')).toBeInTheDocument();
      expect(screen.getByLabelText('Insert tag 2: </bold>')).toBeInTheDocument();
      expect(screen.getByLabelText('Insert tag 3: {1}')).toBeInTheDocument();
      expect(screen.getByLabelText('Insert all tags from source')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    test('applies correct CSS classes for layout', () => {
      const { container } = render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      const menu = container.querySelector('[role="menu"]');
      expect(menu).toHaveClass(
        'absolute',
        'top-full',
        'left-0',
        'bg-surface',
        'border',
        'rounded-md',
        'shadow-lg',
      );
    });

    test('tag preview capsules have correct styling', () => {
      render(
        <TagInsertionUI
          sourceTags={mockSourceTags}
          onInsertTag={mockOnInsertTag}
          onInsertAllTags={mockOnInsertAllTags}
          isVisible={true}
        />,
      );

      const capsule = screen.getByText('[1').closest('span');
      expect(capsule).toHaveClass('bg-brand-soft', 'text-brand', 'border-brand/30');
    });
  });
});
