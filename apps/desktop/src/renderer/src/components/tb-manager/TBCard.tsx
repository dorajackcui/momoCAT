import { IconButton } from '../ui';
import React from 'react';
import type { TBWithStats } from '../../../../shared/ipc';
import { AssetNameEditor } from '../AssetNameEditor';
import { fileBaseName, LinkedFileButton } from '../LinkedFileButton';

interface TBCardProps {
  tb: TBWithStats;
  onPreview: (tbId: string) => void;
  onImport: (tbId: string) => void;
  onSync: (tb: TBWithStats) => void;
  onRename: (tbId: string, name: string) => Promise<void>;
  onDelete: (tbId: string) => void;
  onOpenLinkedFile: (filePath: string) => void;
}

export const TBCard: React.FC<TBCardProps> = ({
  tb,
  onPreview,
  onImport,
  onSync,
  onRename,
  onDelete,
  onOpenLinkedFile,
}) => (
  <div className="workspace-resource-card group">
    <div className="workspace-resource-card-header">
      <div className="min-w-0 flex-1 basis-40">
        <AssetNameEditor
          name={tb.name}
          assetLabel="term base"
          onOpen={() => onPreview(tb.id)}
          onRename={(name) => onRename(tb.id, name)}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1 break-words">
          <span className="text-caption font-semibold text-brand bg-brand-soft px-1.5 py-0.5 rounded-control uppercase tracking-wider">
            {tb.srcLang} → {tb.tgtLang}
          </span>
          {tb.syncConfig && (
            <LinkedFileButton filePath={tb.syncConfig.filePath} onOpen={onOpenLinkedFile} />
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          size="sm"
          tone="brand"
          variant="ghost"
          onClick={() => onPreview(tb.id)}
          title="Preview term base"
          aria-label={`Preview ${tb.name}`}
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
        </IconButton>
        {tb.syncConfig ? (
          <IconButton
            size="sm"
            tone="neutral"
            variant="ghost"
            onClick={() => onSync(tb)}
            title={`Sync from ${fileBaseName(tb.syncConfig.filePath)}`}
            aria-label={`Sync ${tb.name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </IconButton>
        ) : (
          <IconButton
            size="sm"
            tone="brand"
            variant="ghost"
            onClick={() => onImport(tb.id)}
            title="Import terms from file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          </IconButton>
        )}
        <IconButton
          size="sm"
          tone="danger"
          variant="ghost"
          onClick={() => onDelete(tb.id)}
          title="Delete term base"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </IconButton>
      </div>
    </div>
    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-border/40">
      <div className="flex flex-col">
        <span className="text-caption font-semibold text-text-faint uppercase tracking-widest mb-0.5">
          Size
        </span>
        <span className="text-sm font-semibold text-text-muted">{tb.stats.entryCount} terms</span>
      </div>
      <div className="text-caption text-text-faint font-medium">
        Last updated {new Date(tb.updatedAt).toLocaleDateString()}
      </div>
    </div>
  </div>
);
