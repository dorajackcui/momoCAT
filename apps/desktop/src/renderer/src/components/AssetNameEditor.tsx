import { Input, IconButton, Button } from './ui';
import React, { useEffect, useId, useRef, useState } from 'react';

interface AssetNameEditorProps {
  name: string;
  suffix?: string;
  leadingIcon?: React.ReactNode;
  headingLevel?: 'h3' | 'h4';
  assetLabel: string;
  onRename: (name: string) => Promise<void>;
  onOpen?: () => void;
}

export const AssetNameEditor: React.FC<AssetNameEditorProps> = ({
  name,
  suffix = '',
  leadingIcon,
  headingLevel = 'h3',
  assetLabel,
  onRename,
  onOpen,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suffixDescriptionId = useId();
  const displayName = `${name}${suffix}`;
  const Heading = headingLevel;

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const cancel = () => {
    if (isSaving) return;
    setDraftName(name);
    setIsEditing(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextName = draftName.trim();
    if (!nextName) return;
    if (nextName === name) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onRename(nextName);
      setIsEditing(false);
    } catch {
      // The caller reports the failure; keep the editor open for a retry.
    } finally {
      setIsSaving(false);
    }
  };

  const content = isEditing ? (
    <form
      onSubmit={submit}
      onClick={(event) => event.stopPropagation()}
      className="flex w-full max-w-md items-center gap-1 min-w-0"
    >
      <Input
        size="compact"
        appearance="inline"
        ref={inputRef}
        type="text"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        className="min-w-0"
        aria-label={`Rename ${assetLabel}`}
        aria-describedby={suffix ? suffixDescriptionId : undefined}
        disabled={isSaving}
      />
      {suffix && (
        <span id={suffixDescriptionId} className="shrink-0 text-sm font-bold text-text">
          {suffix}
        </span>
      )}
      <IconButton
        size="xs"
        tone="brand"
        variant="ghost"
        type="submit"
        title="Save name"
        aria-label={`Save ${assetLabel} name`}
        disabled={isSaving || !draftName.trim()}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </IconButton>
      <IconButton
        size="xs"
        tone="danger"
        variant="ghost"
        type="button"
        onClick={cancel}
        title="Cancel rename"
        aria-label={`Cancel ${assetLabel} rename`}
        disabled={isSaving}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </IconButton>
    </form>
  ) : (
    <div className="flex items-center gap-1 min-w-0">
      <Heading className="min-w-0 break-words font-medium text-text group-hover:text-brand transition-colors">
        {onOpen ? (
          <Button
            tone="inherit"
            variant="link"
            type="button"
            onClick={onOpen}
            className="max-w-full whitespace-normal break-words text-left"
          >
            {displayName}
          </Button>
        ) : (
          displayName
        )}
      </Heading>
      <IconButton
        size="xs"
        tone="brand"
        variant="ghost"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setDraftName(name);
          setIsEditing(true);
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
        title={`Rename ${assetLabel}`}
        aria-label={`Rename ${displayName}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16.862 3.487a2.12 2.12 0 013 3L8.25 18.1 4 19l.9-4.25L16.862 3.487z"
          />
        </svg>
      </IconButton>
    </div>
  );

  if (!leadingIcon) return content;

  return (
    <div className={`flex min-w-0 items-start gap-2 ${isEditing ? 'w-full max-w-md' : ''}`}>
      <span className="flex h-6 w-4 shrink-0 items-center">{leadingIcon}</span>
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );
};
