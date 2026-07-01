import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EditorBatchActionBar, type EditorBatchActionBarProps } from './EditorBatchActionBar';
import { IconButton } from '../ui';

function renderBar(overrides?: Partial<EditorBatchActionBarProps>) {
  const props: EditorBatchActionBarProps = {
    visible: true,
    canRunActions: true,
    isBatchAITranslating: false,
    isBatchQARunning: false,
    showNonPrintingSymbols: false,
    onOpenBatchAIModal: vi.fn(),
    onCancelBatchAITranslate: vi.fn(),
    onRunBatchQA: vi.fn(),
    onToggleNonPrintingSymbols: vi.fn(),
    ...overrides,
  };

  const element = EditorBatchActionBar(props);
  return { props, element };
}

function getButtons(
  element: ReturnType<typeof EditorBatchActionBar>,
): [React.ReactElement, React.ReactElement, React.ReactElement] {
  if (!element || !React.isValidElement(element)) {
    throw new Error('Expected EditorBatchActionBar to return a valid React element');
  }
  const children = React.Children.toArray(element.props.children).filter(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && child.type === IconButton,
  );
  expect(children).toHaveLength(3);
  return [children[0], children[1], children[2]];
}

function resolveIconClassName(iconButtonElement: React.ReactElement): string {
  const renderedButton = IconButton(iconButtonElement.props);
  const child = renderedButton.props.children as React.ReactElement;
  if (React.isValidElement(child) && typeof child.type === 'function') {
    const nested = child.type(child.props);
    return nested.props.className || '';
  }
  return (child.props?.className as string) || '';
}

describe('EditorBatchActionBar', () => {
  it('renders nothing when visible is false', () => {
    const { element } = renderBar({ visible: false });
    expect(element).toBeNull();
  });

  it('renders two icon buttons with expected labels and titles', () => {
    const { element } = renderBar();
    const [aiButton, qaButton, toggleButton] = getButtons(element);

    expect(aiButton.props.title).toBe('AI Batch Translate');
    expect(qaButton.props.title).toBe('Batch QA');
    expect(toggleButton.props.title).toBe('Show non-printing symbols');
    expect(aiButton.props['aria-label']).toBe('AI batch translate');
    expect(qaButton.props['aria-label']).toBe('Run batch QA');
    expect(toggleButton.props['aria-label']).toBe('Toggle non-printing symbols');
  });

  it('turns the AI button into a cancel control when AI translation is running', () => {
    const onCancelBatchAITranslate = vi.fn();
    const { element } = renderBar({ isBatchAITranslating: true, onCancelBatchAITranslate });
    const [aiButton] = getButtons(element);

    expect(aiButton.props.disabled).toBe(false);
    expect(aiButton.props.title).toBe('Stop AI translation');
    expect(aiButton.props['aria-label']).toBe('Stop AI translation');

    aiButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onCancelBatchAITranslate).toHaveBeenCalledTimes(1);
  });

  it('disables QA button and shows loading icon when QA is running', () => {
    const { element } = renderBar({ isBatchQARunning: true });
    const [, qaButton] = getButtons(element);

    expect(qaButton.props.disabled).toBe(true);
    expect(qaButton.props.title).toBe('Running QA...');
    expect(resolveIconClassName(qaButton)).toContain('animate-spin');
  });

  it('uses active title for non-printing symbols toggle when enabled', () => {
    const { element } = renderBar({ showNonPrintingSymbols: true });
    const [, , toggleButton] = getButtons(element);

    expect(toggleButton.props.title).toBe('Hide non-printing symbols');
  });

  it('invokes callbacks on click', () => {
    const onOpenBatchAIModal = vi.fn();
    const onRunBatchQA = vi.fn();
    const onToggleNonPrintingSymbols = vi.fn();
    const { element } = renderBar({
      onOpenBatchAIModal,
      onRunBatchQA,
      onToggleNonPrintingSymbols,
    });
    const [aiButton, qaButton, toggleButton] = getButtons(element);

    aiButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    qaButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    toggleButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onOpenBatchAIModal).toHaveBeenCalledTimes(1);
    expect(onRunBatchQA).toHaveBeenCalledTimes(1);
    expect(onToggleNonPrintingSymbols).toHaveBeenCalledTimes(1);
  });
});
