import React, { useEffect, useMemo, useState } from 'react';
import type { TagPolicy } from '@cat/core/tag';
import type { ClipboardContent, PastedSourceFileInput } from '../../../../shared/ipc';
import { Button, Card, Modal, Select, Textarea } from '../ui';
import { parsePastedSources } from './pasteSourceParser';

interface PasteSourceModalProps {
  open: boolean;
  clipboard: ClipboardContent;
  creating: boolean;
  onClose: () => void;
  onCreate: (input: PastedSourceFileInput) => void | Promise<void>;
}

const LARGE_PASTE_WARNING_THRESHOLD = 5000;

export function PasteSourceModal({
  open,
  clipboard,
  creating,
  onClose,
  onCreate,
}: PasteSourceModalProps) {
  const [text, setText] = useState(clipboard.text);
  const [tagPolicy, setTagPolicy] = useState<TagPolicy>('default');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText(clipboard.text);
    setTagPolicy('default');
    setIsDirty(false);
  }, [clipboard, open]);

  const sources = useMemo(
    () => parsePastedSources(isDirty ? { text } : clipboard),
    [clipboard, isDirty, text],
  );
  const previewSources = sources.slice(0, 8);
  const hasSources = sources.length > 0;
  const rowLabel = `${sources.length.toLocaleString()} source ${
    sources.length === 1 ? 'row' : 'rows'
  }`;

  return (
    <Modal
      open={open}
      onClose={creating ? undefined : onClose}
      title="Paste Source"
      size="xl"
      closeOnBackdrop={!creating}
      footer={
        <>
          <Button onClick={onClose} variant="secondary" size="lg" disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={() => void onCreate({ sources, tagPolicy })}
            variant="primary"
            size="lg"
            loading={creating}
            disabled={!hasSources || creating}
          >
            Create File
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setIsDirty(true);
          }}
          className="min-h-[220px] font-mono"
          aria-label="Source text"
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium text-text-muted">
            <span>Marker Handling</span>
            <Select
              value={tagPolicy}
              onChange={(event) => setTagPolicy(event.target.value as TagPolicy)}
              className="!w-auto min-w-[180px]"
            >
              <option value="default">Protect CAT markers</option>
              <option value="none">Plain marker-like text</option>
            </Select>
          </label>
          <span className="text-sm font-semibold text-text-muted">{rowLabel}</span>
        </div>

        {!hasSources && (
          <Card variant="danger" className="p-4 text-sm font-medium text-danger">
            No valid source rows found.
          </Card>
        )}

        {sources.length > LARGE_PASTE_WARNING_THRESHOLD && (
          <Card variant="subtle" className="p-4 text-sm font-medium text-warning">
            Large paste: {rowLabel}. Creation is allowed, but import may take longer.
          </Card>
        )}

        {hasSources && (
          <Card variant="surface" className="p-4">
            <h3 className="text-xs font-bold text-text-faint uppercase tracking-wider mb-3">
              Preview
            </h3>
            <ol className="space-y-2 text-sm text-text-muted">
              {previewSources.map((source, index) => (
                <li key={`${index}-${source}`} className="whitespace-pre-wrap">
                  <span className="text-text-faint mr-2">{index + 1}.</span>
                  {source}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </Modal>
  );
}
