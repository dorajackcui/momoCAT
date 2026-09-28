// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TMConcordanceEntry } from '../../../shared/ipc';
import { ConcordancePanel } from './ConcordancePanel';
import { apiClient } from '../services/apiClient';
vi.mock('../services/apiClient', () => ({ apiClient: { searchConcordance: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function deferred() {
  let resolve!: (rows: TMConcordanceEntry[]) => void;
  const promise = new Promise<TMConcordanceEntry[]>((r) => (resolve = r));
  return { promise, resolve };
}
const entry = (text: string) =>
  [
    {
      id: text,
      sourceTokens: [{ type: 'text', content: text }],
      targetTokens: [],
      tmType: 'main',
      tmName: 'TM',
      usageCount: 1,
    },
  ] as TMConcordanceEntry[];
it('keeps the latest search result when an earlier response arrives last', async () => {
  const old = deferred(),
    latest = deferred();
  vi.mocked(apiClient.searchConcordance)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const h = render(<ConcordancePanel projectId={1} externalQuery="old query" searchSignal={1} />);
  h.rerender(<ConcordancePanel projectId={1} externalQuery="new query" searchSignal={2} />);
  await act(async () => latest.resolve(entry('NEW RESULT')));
  expect(screen.getByText('NEW RESULT')).toBeInTheDocument();
  await act(async () => old.resolve(entry('OLD RESULT')));
  expect(screen.getByDisplayValue('new query')).toBeInTheDocument();
  expect(screen.getByText('NEW RESULT')).toBeInTheDocument();
  expect(screen.queryByText('OLD RESULT')).toBeNull();
});
it('keeps the latest search loading until its own response arrives', async () => {
  const old = deferred(),
    latest = deferred();
  vi.mocked(apiClient.searchConcordance)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const h = render(<ConcordancePanel projectId={1} externalQuery="old" searchSignal={1} />);
  h.rerender(<ConcordancePanel projectId={1} externalQuery="new" searchSignal={2} />);
  await act(async () => old.resolve(entry('OLD RESULT')));
  expect(screen.getByText('Searching...')).toBeInTheDocument();
  await act(async () => latest.resolve(entry('NEW RESULT')));
  expect(screen.getByText('NEW RESULT')).toBeInTheDocument();
});
