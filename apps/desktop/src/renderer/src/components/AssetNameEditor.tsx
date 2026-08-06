import React, { useEffect, useId, useRef, useState } from 'react';

interface AssetNameEditorProps {
  name: string;
  suffix?: string;
  headingLevel?: 'h3' | 'h4';
  assetLabel: string;
  onRename: (name: string) => Promise<void>;
}

export const AssetNameEditor: React.FC<AssetNameEditorProps> = ({
  name,
  suffix = '',
  headingLevel = 'h3',
  assetLabel,
  onRename,
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

  if (isEditing) {
    return (
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="flex items-center gap-1 min-w-0"
      >
        <input
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
          className="field-input !px-2 !py-1 text-sm font-bold min-w-0"
          aria-label={`Rename ${assetLabel}`}
          aria-describedby={suffix ? suffixDescriptionId : undefined}
          disabled={isSaving}
        />
        {suffix && (
          <span id={suffixDescriptionId} className="text-sm font-bold text-text">
            {suffix}
          </span>
        )}
        <button
          type="submit"
          className="p-1 text-text-faint hover:text-success hover:bg-success-soft rounded-control transition-colors disabled:opacity-40"
          title="Save name"
          aria-label={`Save ${assetLabel} name`}
          disabled={isSaving || !draftName.trim()}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={cancel}
          className="p-1 text-text-faint hover:text-danger hover:bg-danger-soft rounded-control transition-colors disabled:opacity-40"
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
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Heading className="font-bold text-text group-hover:text-brand transition-colors">
        {displayName}
      </Heading>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setDraftName(name);
          setIsEditing(true);
        }}
        className="p-1 text-text-faint hover:text-brand hover:bg-brand-soft rounded-control transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
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
      </button>
    </div>
  );
};
