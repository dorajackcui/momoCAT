import React, { useId, useState } from 'react';
import type { ProjectType } from '@cat/core/project';
import { Modal, Input, Button, ToggleButton } from './ui';
import { LanguageSelect } from './LanguageSelect';
import { DEFAULT_PROJECT_SOURCE_LANG, DEFAULT_PROJECT_TARGET_LANG } from './languageOptions';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string, srcLang: string, tgtLang: string, projectType: ProjectType) => void;
  loading: boolean;
}

export function CreateProjectModal({
  isOpen,
  onClose,
  onConfirm,
  loading,
}: CreateProjectModalProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('translation');
  const [srcLang, setSrcLang] = useState(DEFAULT_PROJECT_SOURCE_LANG);
  const [tgtLang, setTgtLang] = useState(DEFAULT_PROJECT_TARGET_LANG);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSrcLang = srcLang.trim();
    const trimmedTgtLang = tgtLang.trim();
    if (trimmedName && trimmedSrcLang && trimmedTgtLang) {
      onConfirm(trimmedName, trimmedSrcLang, trimmedTgtLang, projectType);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={loading ? undefined : onClose}
      closeOnBackdrop={false}
      title="Create New Project"
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="field-label mb-2">Project Type</label>
          <div className="grid grid-cols-2 gap-3">
            <ToggleButton
              pressed={projectType === 'translation'}
              tone="brand"
              onClick={() => setProjectType('translation')}
            >
              Translation
            </ToggleButton>
            <ToggleButton
              pressed={projectType === 'custom'}
              tone="brand"
              onClick={() => setProjectType('custom')}
            >
              Custom
            </ToggleButton>
          </div>
        </div>

        <div>
          <label htmlFor={formId + '-name'} className="field-label">
            Project Name
          </label>
          <Input
            id={formId + '-name'}
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q1 Marketing Campaign"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Source Language</label>
            <LanguageSelect value={srcLang} onChange={setSrcLang} required />
          </div>
          <div>
            <label className="field-label">Target Language</label>
            <LanguageSelect value={tgtLang} onChange={setTgtLang} required />
          </div>
        </div>

        <div className="pt-4 flex gap-3">
          <Button
            variant="secondary"
            type="button"
            disabled={loading}
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={loading || !name.trim() || !srcLang.trim() || !tgtLang.trim()}
            className="flex-1"
          >
            {loading ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
