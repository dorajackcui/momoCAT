import React from 'react';
import type {
  TBAssetPreview,
  TBWithStats,
  TMAssetPreview,
  TMWithStats,
} from '../../../shared/ipc';
import { Modal } from './ui/Modal';

type AssetPreviewModalProps =
  | {
      kind: 'tm';
      asset: TMWithStats | null;
      preview: TMAssetPreview | null;
      loading: boolean;
      error: string | null;
      onClose: () => void;
      onRetry: () => void;
    }
  | {
      kind: 'tb';
      asset: TBWithStats | null;
      preview: TBAssetPreview | null;
      loading: boolean;
      error: string | null;
      onClose: () => void;
      onRetry: () => void;
    };

export const AssetPreviewModal: React.FC<AssetPreviewModalProps> = (props) => {
  const { asset, loading, error, onClose, onRetry } = props;
  const preview = props.preview;

  return (
    <Modal
      open={asset !== null}
      onClose={onClose}
      title={asset ? `${asset.name} Preview` : 'Preview'}
      size="xl"
      bodyClassName="space-y-4"
    >
      {asset && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-brand bg-brand-soft px-2 py-1 rounded-control uppercase tracking-wider">
            {asset.srcLang} -&gt; {asset.tgtLang}
          </span>
          <span className="font-semibold text-text-muted bg-muted px-2 py-1 rounded-control uppercase tracking-wider">
            {asset.stats.entryCount} {props.kind === 'tm' ? 'segments' : 'terms'}
          </span>
          <span className="text-text-faint">Preview rows are capped at 10.</span>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm text-text-faint">Loading preview...</p>
        </div>
      ) : error ? (
        <div className="rounded-control border border-danger/40 bg-danger-soft px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-danger">{error}</p>
            <button type="button" onClick={onRetry} className="btn-secondary text-xs">
              Retry
            </button>
          </div>
        </div>
      ) : preview && preview.rows.length > 0 ? (
        <div className="overflow-hidden rounded-control border border-border/60">
          <div className="max-h-[460px] overflow-auto custom-scrollbar">
            {props.kind === 'tm'
              ? renderTMTable(preview as TMAssetPreview)
              : renderTBTable(preview as TBAssetPreview)}
          </div>
        </div>
      ) : (
        <div className="rounded-control border border-border/60 bg-muted/40 px-4 py-8 text-center">
          <p className="text-sm font-medium text-text-muted">No entries to preview.</p>
        </div>
      )}
    </Modal>
  );
};

function renderTMTable(preview: TMAssetPreview) {
  return (
    <table className="w-full table-fixed text-left text-xs">
      <thead className="sticky top-0 bg-surface border-b border-border/60">
        <tr>
          <th className="w-[46%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Source
          </th>
          <th className="w-[46%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Target
          </th>
          <th className="w-[8%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Uses
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {preview.rows.map((row) => (
          <tr key={row.id} className="bg-canvas">
            <td className="px-3 py-2 align-top text-text whitespace-pre-wrap break-words">
              {row.source}
            </td>
            <td className="px-3 py-2 align-top text-text whitespace-pre-wrap break-words">
              {row.target}
            </td>
            <td className="px-3 py-2 align-top text-text-muted">{row.usageCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderTBTable(preview: TBAssetPreview) {
  return (
    <table className="w-full table-fixed text-left text-xs">
      <thead className="sticky top-0 bg-surface border-b border-border/60">
        <tr>
          <th className="w-[32%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Source Term
          </th>
          <th className="w-[32%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Target Term
          </th>
          <th className="w-[28%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Note
          </th>
          <th className="w-[8%] px-3 py-2 font-semibold text-text-muted uppercase tracking-wider">
            Uses
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {preview.rows.map((row) => (
          <tr key={row.id} className="bg-canvas">
            <td className="px-3 py-2 align-top text-text whitespace-pre-wrap break-words">
              {row.sourceTerm}
            </td>
            <td className="px-3 py-2 align-top text-text whitespace-pre-wrap break-words">
              {row.targetTerm}
            </td>
            <td className="px-3 py-2 align-top text-text-muted whitespace-pre-wrap break-words">
              {row.note || '-'}
            </td>
            <td className="px-3 py-2 align-top text-text-muted">{row.usageCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
