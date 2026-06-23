import React, { useEffect, useMemo, useRef, useState } from 'react';
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

export function createPasteSourceDrafts(clipboard: ClipboardContent): string[] {
  return parsePastedSources(clipboard);
}

export function shouldInitializePasteSourceDrafts(wasOpen: boolean, isOpen: boolean): boolean {
  return !wasOpen && isOpen;
}

export function buildPasteSourceFileInput(
  sourceDrafts: string[],
  tagPolicy: TagPolicy,
): PastedSourceFileInput {
  return {
    sources: sourceDrafts.map((source) => source.trim()).filter((source) => source.length > 0),
    tagPolicy,
  };
}

export function PasteSourceModal({
  open,
  clipboard,
  creating,
  onClose,
  onCreate,
}: PasteSourceModalProps) {
  const [sourceDrafts, setSourceDrafts] = useState<string[]>(() =>
    createPasteSourceDrafts(clipboard),
  );
  const [tagPolicy, setTagPolicy] = useState<TagPolicy>('default');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const shouldInitialize = shouldInitializePasteSourceDrafts(wasOpenRef.current, open);
    wasOpenRef.current = open;
    if (!shouldInitialize) return;

    setSourceDrafts(createPasteSourceDrafts(clipboard));
    setTagPolicy('default');
  }, [clipboard, open]);

  const input = useMemo(
    () => buildPasteSourceFileInput(sourceDrafts, tagPolicy),
    [sourceDrafts, tagPolicy],
  );
  const { sources } = input;
  const hasSources = sources.length > 0;
  const rowLabel = `${sources.length.toLocaleString()} source ${
    sources.length === 1 ? 'row' : 'rows'
  }`;

  const updateSourceDraft = (index: number, value: string) => {
    setSourceDrafts((current) =>
      current.map((source, currentIndex) => (currentIndex === index ? value : source)),
    );
  };

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
            onClick={() => void onCreate(input)}
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
        {sourceDrafts.length > 0 && (
          <div className="max-h-[360px] overflow-auto space-y-3 pr-1">
            {sourceDrafts.map((source, index) => (
              <label
                key={index}
                className="grid grid-cols-[2.5rem_1fr] gap-3 text-sm text-text-muted"
              >
                <span className="pt-3 text-right font-semibold text-text-faint">{index + 1}.</span>
                <Textarea
                  value={source}
                  onChange={(event) => updateSourceDraft(index, event.target.value)}
                  className="min-h-[84px] font-mono"
                  aria-label={`Source row ${index + 1}`}
                />
              </label>
            ))}
          </div>
        )}

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

      </div>
    </Modal>
  );
}
