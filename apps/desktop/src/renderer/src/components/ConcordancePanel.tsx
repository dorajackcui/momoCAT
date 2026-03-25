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
    <div className="flex flex-col h-full bg-surface border-l border-border w-80">
      <div className="p-4 border-b border-border/60 bg-muted/50">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">
          Concordance Search
        </h3>
        <form onSubmit={handleSearch} className="relative">
          <input
            ref={inputRef}
            type="text"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-border rounded-lg focus:ring-2 focus:ring-brand/20 outline-none transition-all"
            placeholder="Search TM..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isSearching ? (
          <div className="text-center py-8 text-text-faint text-xs italic">Searching...</div>
        ) : results.length > 0 ? (
          results.map((entry) => (
            <div key={entry.id} className="group border-b border-border/40 pb-4 last:border-0">
              <div className="text-[13px] text-text-muted mb-1.5 leading-snug">
                {serializeTokensToDisplayText(entry.sourceTokens)}
              </div>
              <div className="text-[13px] text-brand leading-snug italic">
                {serializeTokensToDisplayText(entry.targetTokens)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-text-faint">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1 py-0.5 rounded-[3px] font-bold uppercase text-[8px] ${entry.tmType === 'working' ? 'bg-brand-soft text-brand' : 'bg-info-soft text-info'}`}
                  >
                    {entry.tmType === 'working' ? 'Working' : entry.tmName}
                  </span>
                  <span>Used {entry.usageCount} times</span>
                </div>
                <button className="text-brand hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                  Apply
                </button>
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
