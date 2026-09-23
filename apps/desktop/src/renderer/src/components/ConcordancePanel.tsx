import { SearchInput, Button } from './ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { apiClient } from '../services/apiClient';
import type { TMConcordanceEntry } from '../../../shared/ipc';

interface ConcordancePanelProps {
  projectId: number;
  focusSignal?: number;
  externalQuery?: string;
  searchSignal?: number;
}

export const ConcordancePanel: React.FC<ConcordancePanelProps> = ({
  projectId,
  focusSignal = 0,
  externalQuery = '',
  searchSignal = 0,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMConcordanceEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const trimmedQuery = rawQuery.trim();
      if (!trimmedQuery) {
        setResults([]);
        return;
      }

      setIsSearching(true);
      try {
        const data = await apiClient.searchConcordance(projectId, trimmedQuery);
        setResults(data);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [focusSignal]);

  useEffect(() => {
    if (searchSignal <= 0) return;
    const trimmedQuery = externalQuery.trim();
    if (!trimmedQuery) return;

    setQuery(trimmedQuery);
    void runSearch(trimmedQuery);
  }, [externalQuery, runSearch, searchSignal]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await runSearch(query);
  };

  return (
    <div className="flex flex-col h-full bg-surface-panel w-full">
      <div className="p-4 border-b border-border-subtle bg-surface-chrome">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">
          Concordance Search
        </h3>
        <form onSubmit={handleSearch} className="relative">
          <SearchInput
            ref={inputRef}
            type="text"
            placeholder="Search TM..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      </div>

      <div className="quiet-scrollbar flex-1 overflow-y-auto p-4 space-y-4">
        {isSearching ? (
          <div className="text-center py-8 text-text-faint text-xs italic">Searching...</div>
        ) : results.length > 0 ? (
          results.map((entry) => (
            <div key={entry.id} className="group border-b border-border-subtle pb-4 last:border-0">
              <div className="content-text text-sm text-text-muted mb-1.5 leading-snug">
                {serializeTokensToDisplayText(entry.sourceTokens)}
              </div>
              <div className="content-text text-sm text-text leading-snug italic">
                {serializeTokensToDisplayText(entry.targetTokens)}
              </div>
              <div className="mt-2 flex items-center justify-between text-caption text-text-faint">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1 py-0.5 rounded-[3px] font-bold uppercase text-reference-badge ${entry.tmType === 'working' ? 'bg-brand-soft text-brand' : 'bg-info-soft text-info'}`}
                  >
                    {entry.tmType === 'working' ? 'Working' : entry.tmName}
                  </span>
                  <span>Used {entry.usageCount} times</span>
                </div>
                <Button tone="brand" variant="link" className="opacity-0 group-hover:opacity-100">
                  Apply
                </Button>
              </div>
            </div>
          ))
        ) : query ? (
          <div className="text-center py-8 text-text-faint text-xs">
            No matches found for &quot;{query}&quot;
          </div>
        ) : (
          <div className="text-center py-8 text-text-faint text-xs italic">
            Enter keywords to search across project memory.
          </div>
        )}
      </div>
    </div>
  );
};
