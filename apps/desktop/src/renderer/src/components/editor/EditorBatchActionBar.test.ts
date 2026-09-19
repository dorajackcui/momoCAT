import { renderToStaticMarkup } from 'react-dom/server';
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
    onOpenBatchAIModal: vi.fn(),
    onCancelBatchAITranslate: vi.fn(),
    onRunBatchQA: vi.fn(),
    ...overrides,
  };

  const element = EditorBatchActionBar(props);
  return { props, element };
}

function getButtons(
  element: ReturnType<typeof EditorBatchActionBar>,
): [React.ReactElement, React.ReactElement] {
  if (!element || !React.isValidElement(element)) {
    throw new Error('Expected EditorBatchActionBar to return a valid React element');
  }
  const children = React.Children.toArray(element.props.children).filter(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && child.type === IconButton,
  );
  expect(children).toHaveLength(2);
  return [children[0], children[1]];
}

function resolveIconClassName(iconButtonElement: React.ReactElement): string {
  return renderToStaticMarkup(iconButtonElement);
}

describe('EditorBatchActionBar', () => {
  it('renders nothing when visible is false', () => {
    const { element } = renderBar({ visible: false });
    expect(element).toBeNull();
  });

  it('renders two icon buttons with expected labels and titles', () => {
    const { element } = renderBar();
    const [aiButton, qaButton] = getButtons(element);

    expect(aiButton.props.title).toBe('AI Batch Translate');
    expect(qaButton.props.title).toBe('Batch QA');
    expect(aiButton.props['aria-label']).toBe('AI batch translate');
    expect(qaButton.props['aria-label']).toBe('Run batch QA');
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

  it('invokes callbacks on click', () => {
    const onOpenBatchAIModal = vi.fn();
    const onRunBatchQA = vi.fn();
    const { element } = renderBar({
      onOpenBatchAIModal,
      onRunBatchQA,
    });
    const [aiButton, qaButton] = getButtons(element);

    aiButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
    qaButton.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);

    expect(onOpenBatchAIModal).toHaveBeenCalledTimes(1);
    expect(onRunBatchQA).toHaveBeenCalledTimes(1);
  });
});
