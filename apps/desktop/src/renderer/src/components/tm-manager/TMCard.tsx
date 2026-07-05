import React from 'react';
import type { TMWithStats } from '../../../../shared/ipc';

export function fileBaseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/u);
  return segments[segments.length - 1] || filePath;
}

interface TMCardProps {
  tm: TMWithStats;
  onPreview: (tmId: string) => void;
  onImport: (tmId: string) => void;
  onSync: (tm: TMWithStats) => void;
  onDelete: (tmId: string) => void;
}

export const TMCard: React.FC<TMCardProps> = ({ tm, onPreview, onImport, onSync, onDelete }) => (
  <div className="surface-card p-5 hover:border-brand/40 transition-colors group">
    <div className="flex justify-between items-start mb-3">
      <div>
        <h3 className="font-bold text-text group-hover:text-brand transition-colors">{tm.name}</h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-semibold text-brand bg-brand-soft px-1.5 py-0.5 rounded-control uppercase tracking-wider">
            {tm.srcLang} → {tm.tgtLang}
          </span>
          <span className="text-[10px] font-semibold text-text-muted bg-muted px-1.5 py-0.5 rounded-control uppercase tracking-wider">
            Main TM
          </span>
          {tm.syncConfig && (
            <span
              className="text-[10px] font-semibold text-success bg-success-soft px-1.5 py-0.5 rounded-control tracking-wider"
              title={tm.syncConfig.filePath}
            >
              ⟳ {fileBaseName(tm.syncConfig.filePath)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPreview(tm.id)}
          className="p-1.5 text-text-faint hover:text-brand hover:bg-brand-soft rounded-control transition-colors"
          title="Preview TM"
          aria-label={`Preview ${tm.name}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15.25A3.25 3.25 0 1012 8.75a3.25 3.25 0 000 6.5z"
            />
          </svg>
        </button>
        {tm.syncConfig ? (
          <button
            onClick={() => onSync(tm)}
            className="p-1.5 text-text-faint hover:text-success hover:bg-success-soft rounded-control transition-colors"
            title={`Sync from ${fileBaseName(tm.syncConfig.filePath)}`}
            aria-label={`Sync ${tm.name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => onImport(tm.id)}
            className="p-1.5 text-text-faint hover:text-brand hover:bg-brand-soft rounded-control transition-colors"
            title="Import from Excel/CSV"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </button>
        )}
        <button
          onClick={() => onDelete(tm.id)}
          className="p-1.5 text-text-faint hover:text-danger hover:bg-danger-soft rounded-control transition-colors"
          title="Delete TM"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
    <div className="flex items-center justify-between pt-4 border-t border-border/40">
      <div className="flex flex-col">
        <span className="text-[10px] font-semibold text-text-faint uppercase tracking-widest mb-0.5">
          Size
        </span>
        <span className="text-sm font-semibold text-text-muted">
          {tm.stats.entryCount} segments
        </span>
      </div>
      <div className="text-[10px] text-text-faint font-medium text-right">
        {tm.syncConfig?.lastSyncAttemptedAt || tm.syncConfig?.lastSyncedAt ? (
          <span className={tm.syncConfig.lastSyncStatus === 'failed' ? 'text-danger' : undefined}>
            Last sync{' '}
            {new Date(
              tm.syncConfig.lastSyncAttemptedAt ?? tm.syncConfig.lastSyncedAt ?? '',
            ).toLocaleString()}
            {tm.syncConfig.lastSyncStatus === 'failed' && ' (failed)'}
            {tm.syncConfig.lastSyncStatus === 'cancelled' && ' (cancelled)'}
          </span>
        ) : (
          <span>Last updated {new Date().toLocaleDateString()}</span>
        )}
      </div>
    </div>
  </div>
);
