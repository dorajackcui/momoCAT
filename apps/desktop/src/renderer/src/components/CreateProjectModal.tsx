import React, { useState } from 'react';
import type { ProjectType } from '@cat/core/project';
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
    <div className="modal-backdrop">
      <div className="modal-card max-w-md animate-in fade-in zoom-in duration-200">
        <div className="modal-header">
          <h2 className="text-xl font-bold text-text">Create New Project</h2>
          <button
            onClick={onClose}
            className="text-text-faint hover:text-text-muted transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div>
            <label className="field-label mb-2">Project Type</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setProjectType('translation')}
                className={`px-3 py-2 rounded-control border text-sm font-semibold transition-colors ${
                  projectType === 'translation'
                    ? 'border-brand/40 bg-brand-soft text-brand'
                    : 'border-border bg-surface text-text-muted hover:bg-muted'
                }`}
              >
                Translation
              </button>
              <button
                type="button"
                onClick={() => setProjectType('review')}
                className={`px-3 py-2 rounded-control border text-sm font-semibold transition-colors ${
                  projectType === 'review'
                    ? 'border-warning/40 bg-warning-soft text-warning'
                    : 'border-border bg-surface text-text-muted hover:bg-muted'
                }`}
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => setProjectType('custom')}
                className={`px-3 py-2 rounded-control border text-sm font-semibold transition-colors ${
                  projectType === 'custom'
                    ? 'border-success/40 bg-success-soft text-success'
                    : 'border-border bg-surface text-text-muted hover:bg-muted'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          <div>
            <label className="field-label">Project Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q1 Marketing Campaign"
              className="field-input"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Source Language</label>
              <LanguageSelect
                value={srcLang}
                onChange={setSrcLang}
                className="field-input"
                required
              />
            </div>
            <div>
              <label className="field-label">Target Language</label>
              <LanguageSelect
                value={tgtLang}
                onChange={setTgtLang}
                className="field-input"
                required
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !srcLang.trim() || !tgtLang.trim()}
              className="btn-primary flex-1"
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
