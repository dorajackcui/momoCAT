import React, { useState, useEffect } from 'react';
import { TMImportWizard } from './TMImportWizard';
import { AssetPreviewModal } from './AssetPreviewModal';
import { LanguageSelect } from './LanguageSelect';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';
import { DEFAULT_ASSET_SOURCE_LANG, DEFAULT_ASSET_TARGET_LANG } from './languageOptions';
import type {
  ImportExecutionResult,
  SpreadsheetPreviewData,
  StructuredJobError,
  TMAssetPreview,
  TMImportOptions,
  TMWithStats,
} from '../../../shared/ipc';

type ImportNotice = {
  tone: 'success' | 'error';
  message: string;
};

export const TMManager: React.FC = () => {
  const [tms, setTMs] = useState<TMWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSrc, setNewSrc] = useState(DEFAULT_ASSET_SOURCE_LANG);
  const [newTgt, setNewTgt] = useState(DEFAULT_ASSET_TARGET_LANG);

  // Import State
  const [importingTMId, setImportingTMId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<SpreadsheetPreviewData>([]);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [previewTMId, setPreviewTMId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, TMAssetPreview>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadTMs = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listTMs('main');
      setTMs(data);
    } catch (e) {
      console.error('Failed to load TMs', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTMs();
  }, []);

  const selectedPreviewTM = previewTMId ? tms.find((tm) => tm.id === previewTMId) ?? null : null;
  const selectedPreview = previewTMId ? previewCache[previewTMId] ?? null : null;

  const clearPreviewCache = (tmId: string) => {
    setPreviewCache((current) => {
      const next = { ...current };
      delete next[tmId];
      return next;
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    try {
      await apiClient.createTM(newName, newSrc, newTgt, 'main');
      setNewName('');
      setShowCreate(false);
      loadTMs();
    } catch {
      feedbackService.error('Failed to create TM');
    }
  };

  const handleOpenPreview = async (tmId: string, force: boolean = false) => {
    setPreviewTMId(tmId);
    setPreviewError(null);

    if (!force && previewCache[tmId]) {
      return;
    }

    setPreviewLoading(true);
    try {
      const preview = await apiClient.getTMPreview(tmId);
      setPreviewCache((current) => ({ ...current, [tmId]: preview }));
    } catch {
      setPreviewError('Failed to load TM preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    setPreviewTMId(null);
    setPreviewError(null);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await feedbackService.confirm(
      'Are you sure you want to delete this Main TM? All data inside will be lost.',
    );
    if (!confirmed) return;
    try {
      await apiClient.deleteTM(id);
      clearPreviewCache(id);
      if (previewTMId === id) {
        handleClosePreview();
      }
      loadTMs();
    } catch {
      feedbackService.error('Failed to delete TM');
    }
  };

  const handleStartImport = async (tmId: string) => {
    setImportNotice(null);
    const filePath = await apiClient.openFileDialog([
      { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] },
    ]);
    if (!filePath) return;

    try {
      const preview = await apiClient.getTMImportPreview(filePath);
      setImportingTMId(tmId);
      setImportFilePath(filePath);
      setImportPreview(preview);
      setIsImportWizardOpen(true);
    } catch {
      feedbackService.error('Failed to read file for preview');
    }
  };

  const handleConfirmImport = async (options: TMImportOptions) => {
    if (!importingTMId || !importFilePath) return;

    try {
      const jobId = await apiClient.importTMEntries(importingTMId, importFilePath, options);
      setImportJobId(jobId);
    } catch (error) {
      setImportNotice({
        tone: 'error',
        message: `Failed to start import: ${error instanceof Error ? error.message : String(error)}`,
      });
      setIsImportWizardOpen(false);
      setImportJobId(null);
      setImportingTMId(null);
      setImportFilePath(null);
    }
  };

  const handleImportCompleted = (result: ImportExecutionResult) => {
    const completedTMId = importingTMId;
    setImportNotice({
      tone: 'success',
      message: `Import completed: ${result.success} imported, ${result.skipped} skipped.`,
    });
    setIsImportWizardOpen(false);
    setImportJobId(null);
    setImportingTMId(null);
    setImportFilePath(null);
    if (completedTMId) {
      clearPreviewCache(completedTMId);
    }
    void loadTMs();
  };

  const handleImportFailed = (error: StructuredJobError) => {
    setImportNotice({
      tone: 'error',
      message: `Import failed (${error.code}): ${error.message}`,
    });
    setIsImportWizardOpen(false);
    setImportJobId(null);
    setImportingTMId(null);
    setImportFilePath(null);
  };

  return (
    <div className="flex-1 p-8 bg-canvas overflow-y-auto custom-scrollbar">
      <TMImportWizard
        isOpen={isImportWizardOpen}
        previewData={importPreview}
        jobId={importJobId}
        onClose={() => {
          if (importJobId) return;
          setIsImportWizardOpen(false);
          setImportingTMId(null);
          setImportFilePath(null);
        }}
        onConfirm={handleConfirmImport}
        onJobCompleted={handleImportCompleted}
        onJobFailed={handleImportFailed}
      />
      <AssetPreviewModal
        kind="tm"
        asset={selectedPreviewTM}
        preview={selectedPreview}
        loading={previewLoading}
        error={previewError}
        onClose={handleClosePreview}
        onRetry={() => {
          if (previewTMId) {
            void handleOpenPreview(previewTMId, true);
          }
        }}
      />

      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text">TM Management</h1>
            <p className="text-sm text-text-muted mt-1">Manage your Main TMs</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            Create Main TM
          </button>
        </div>

        {importNotice && (
          <div
            className={`mb-6 rounded-control border px-4 py-3 text-sm ${
              importNotice.tone === 'success'
                ? 'border-success/40 bg-success-soft text-success'
                : 'border-danger/40 bg-danger-soft text-danger'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{importNotice.message}</span>
              <button
                type="button"
                onClick={() => setImportNotice(null)}
                className="text-xs font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="mb-8 p-6 surface-card animate-in fade-in slide-in-from-top-4">
            <h2 className="field-label !text-[10px] mb-4">Create New Main TM</h2>
            <form onSubmit={handleCreate} className="grid grid-cols-4 gap-4 items-end">
              <div className="col-span-2">
                <label className="field-label !text-[10px]">TM Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="field-input !px-3 !py-2 text-sm"
                  placeholder="e.g. Technical Glossary"
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label !text-[10px]">Source</label>
                <LanguageSelect
                  value={newSrc}
                  onChange={setNewSrc}
                  className="field-input !px-3 !py-2 text-sm"
                />
              </div>
              <div>
                <label className="field-label !text-[10px]">Target</label>
                <LanguageSelect
                  value={newTgt}
                  onChange={setNewTgt}
                  className="field-input !px-3 !py-2 text-sm"
                />
              </div>
              <div className="col-span-4 flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary !px-6">
                  Save TM
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-sm text-text-faint">Loading TM assets...</p>
          </div>
        ) : tms.length === 0 ? (
          <div className="surface-card border-dashed p-12 text-center">
            <div className="text-3xl mb-4">📚</div>
            <h3 className="text-sm font-bold text-text mb-1">No Main TMs found</h3>
            <p className="text-xs text-text-muted mb-6">
              Create a Main TM to store your verified high-quality translations.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-brand text-sm font-semibold hover:underline"
            >
              + Create your first Main TM
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tms.map((tm) => (
              <div
                key={tm.id}
                className="surface-card p-5 hover:border-brand/40 transition-colors group"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-text group-hover:text-brand transition-colors">
                      {tm.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-semibold text-brand bg-brand-soft px-1.5 py-0.5 rounded-control uppercase tracking-wider">
                        {tm.srcLang} → {tm.tgtLang}
                      </span>
                      <span className="text-[10px] font-semibold text-text-muted bg-muted px-1.5 py-0.5 rounded-control uppercase tracking-wider">
                        Main TM
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleOpenPreview(tm.id)}
                      className="p-1.5 text-text-faint hover:text-brand hover:bg-brand-soft rounded-control transition-colors"
                      title="Preview TM"
                      aria-label={`Preview ${tm.name}`}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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
                    <button
                      onClick={() => handleStartImport(tm.id)}
                      className="p-1.5 text-text-faint hover:text-brand hover:bg-brand-soft rounded-control transition-colors"
                      title="Import from Excel/CSV"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(tm.id)}
                      className="p-1.5 text-text-faint hover:text-danger hover:bg-danger-soft rounded-control transition-colors"
                      title="Delete TM"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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
                  <div className="text-[10px] text-text-faint font-medium">
                    Last updated {new Date().toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
