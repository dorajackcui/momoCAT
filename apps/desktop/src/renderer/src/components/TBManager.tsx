import React, { useEffect, useState } from 'react';
import { TBImportWizard, type TBWizardMode } from './TBImportWizard';
import { AssetPreviewModal } from './AssetPreviewModal';
import { LanguageSelect } from './LanguageSelect';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';
import { DEFAULT_ASSET_SOURCE_LANG, DEFAULT_ASSET_TARGET_LANG } from './languageOptions';
import {
  confirmTBSyncLink,
  pickTBSyncSource,
  runTBSyncNow,
  TB_SPREADSHEET_FILTERS,
} from './tb-manager/tbSyncActions';
import { TBCard } from './tb-manager/TBCard';
import type {
  ImportExecutionResult,
  SpreadsheetPreviewData,
  StructuredJobError,
  TBAssetPreview,
  TBImportOptions,
  TBWithStats,
} from '../../../shared/ipc';

type ImportNotice = {
  tone: 'success' | 'error';
  message: string;
};

type CreateSource = 'upload' | 'sync';

const CREATE_SOURCE_OPTIONS: Array<{ value: CreateSource; label: string; hint: string }> = [
  { value: 'upload', label: 'Standard TB', hint: 'Update by uploading Excel files' },
  { value: 'sync', label: 'Sync with Excel', hint: 'Mirror a linked local file' },
];

export const TBManager: React.FC = () => {
  const [tbs, setTBs] = useState<TBWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSrc, setNewSrc] = useState(DEFAULT_ASSET_SOURCE_LANG);
  const [newTgt, setNewTgt] = useState(DEFAULT_ASSET_TARGET_LANG);
  const [createSource, setCreateSource] = useState<CreateSource>('upload');

  const [wizardMode, setWizardMode] = useState<TBWizardMode>('import');
  const [importingTBId, setImportingTBId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<SpreadsheetPreviewData>([]);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [previewTBId, setPreviewTBId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, TBAssetPreview>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadTBs = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listTBs();
      setTBs(data);
    } catch (error) {
      console.error('Failed to load term bases', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTBs();
  }, []);

  const handleOpenLinkedFile = async (filePath: string) => {
    try {
      await apiClient.openLocalFile(filePath);
    } catch (error) {
      feedbackService.error(
        `Failed to open linked file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const selectedPreviewTB = previewTBId ? (tbs.find((tb) => tb.id === previewTBId) ?? null) : null;
  const selectedPreview = previewTBId ? (previewCache[previewTBId] ?? null) : null;

  const clearPreviewCache = (tbId: string) => {
    setPreviewCache((current) => {
      const next = { ...current };
      delete next[tbId];
      return next;
    });
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;

    let tbId: string;
    try {
      tbId = await apiClient.createTB(newName.trim(), newSrc.trim(), newTgt.trim());
      setNewName('');
      setShowCreate(false);
      await loadTBs();
    } catch {
      feedbackService.error('Failed to create term base.');
      return;
    }

    // A standard TB starts empty and is updated later via the card's upload
    // button; a synced TB is unusable without its binding, so link it now.
    if (createSource === 'sync') {
      await handleStartLink(tbId);
    }
  };

  const handleOpenPreview = async (tbId: string, force: boolean = false) => {
    setPreviewTBId(tbId);
    setPreviewError(null);

    if (!force && previewCache[tbId]) {
      return;
    }

    setPreviewLoading(true);
    try {
      const preview = await apiClient.getTBPreview(tbId);
      setPreviewCache((current) => ({ ...current, [tbId]: preview }));
    } catch {
      setPreviewError('Failed to load term base preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    setPreviewTBId(null);
    setPreviewError(null);
  };

  const handleDelete = async (tbId: string) => {
    const confirmed = await feedbackService.confirm(
      'Are you sure you want to delete this term base? All terms will be deleted.',
    );
    if (!confirmed) return;
    try {
      await apiClient.deleteTB(tbId);
      clearPreviewCache(tbId);
      if (previewTBId === tbId) {
        handleClosePreview();
      }
      await loadTBs();
    } catch {
      feedbackService.error('Failed to delete term base.');
    }
  };

  const handleStartImport = async (tbId: string) => {
    setImportNotice(null);
    const filePath = await apiClient.openFileDialog(TB_SPREADSHEET_FILTERS);
    if (!filePath) return;

    try {
      const preview = await apiClient.getTBImportPreview(filePath);
      setWizardMode('import');
      setImportingTBId(tbId);
      setImportFilePath(filePath);
      setImportPreview(preview);
      setIsImportWizardOpen(true);
    } catch {
      feedbackService.error('Failed to read file for preview.');
    }
  };

  const handleStartLink = async (tbId: string) => {
    setImportNotice(null);
    const picked = await pickTBSyncSource({
      openFileDialog: apiClient.openFileDialog,
      getTBImportPreview: apiClient.getTBImportPreview,
      error: feedbackService.error,
    });
    if (!picked) return;

    setWizardMode('sync');
    setImportingTBId(tbId);
    setImportFilePath(picked.filePath);
    setImportPreview(picked.preview);
    setIsImportWizardOpen(true);
  };

  const handleSyncNow = async (tb: TBWithStats) => {
    setImportNotice(null);
    const outcome = await runTBSyncNow(tb, {
      syncTBWithExcel: apiClient.syncTBWithExcel,
      confirmRelink: feedbackService.confirm,
      error: feedbackService.error,
    });

    if (outcome.kind === 'started') {
      setWizardMode('sync');
      setImportingTBId(tb.id);
      setImportFilePath(tb.syncConfig?.filePath ?? null);
      setImportPreview([]);
      setIsImportWizardOpen(true);
      setImportJobId(outcome.jobId);
    } else if (outcome.kind === 'relink-requested') {
      await handleStartLink(tb.id);
    }
  };

  const handleConfirmImport = async (options: TBImportOptions) => {
    if (!importingTBId || !importFilePath) return;

    if (wizardMode === 'sync') {
      const result = await confirmTBSyncLink(importingTBId, importFilePath, options, {
        setTBSyncConfig: apiClient.setTBSyncConfig,
        syncTBWithExcel: apiClient.syncTBWithExcel,
        error: feedbackService.error,
      });
      if (!result || result.status !== 'started') {
        setIsImportWizardOpen(false);
        setImportJobId(null);
        setImportingTBId(null);
        setImportFilePath(null);
        if (result?.status === 'file-missing') {
          feedbackService.error(`The linked Excel file could not be read: ${result.filePath}`);
        }
        return;
      }
      setImportJobId(result.jobId);
      return;
    }

    try {
      const jobId = await apiClient.importTBEntries(importingTBId, importFilePath, options);
      setImportJobId(jobId);
    } catch (error) {
      setImportNotice({
        tone: 'error',
        message: `Failed to start import: ${error instanceof Error ? error.message : String(error)}`,
      });
      setIsImportWizardOpen(false);
      setImportJobId(null);
      setImportingTBId(null);
      setImportFilePath(null);
    }
  };

  const handleImportCompleted = (result: ImportExecutionResult) => {
    const completedTBId = importingTBId;
    setImportNotice({
      tone: 'success',
      message:
        wizardMode === 'sync'
          ? `Sync completed: ${result.success} terms mirrored, ${result.skipped} rows skipped.`
          : `Import completed: ${result.success} imported, ${result.skipped} skipped.`,
    });
    setIsImportWizardOpen(false);
    setImportJobId(null);
    setImportingTBId(null);
    setImportFilePath(null);
    if (completedTBId) {
      clearPreviewCache(completedTBId);
    }
    void loadTBs();
  };

  const handleImportFailed = (error: StructuredJobError) => {
    setImportNotice({
      tone: 'error',
      message:
        wizardMode === 'sync'
          ? `Sync failed (${error.code}): ${error.message}`
          : `Import failed (${error.code}): ${error.message}`,
    });
    setIsImportWizardOpen(false);
    setImportJobId(null);
    setImportingTBId(null);
    setImportFilePath(null);
    void loadTBs();
  };

  return (
    <div className="flex-1 p-8 bg-canvas overflow-y-auto custom-scrollbar">
      <TBImportWizard
        isOpen={isImportWizardOpen}
        previewData={importPreview}
        jobId={importJobId}
        mode={wizardMode}
        onClose={() => {
          if (importJobId) return;
          setIsImportWizardOpen(false);
          setImportingTBId(null);
          setImportFilePath(null);
        }}
        onConfirm={handleConfirmImport}
        onJobCompleted={handleImportCompleted}
        onJobFailed={handleImportFailed}
      />
      <AssetPreviewModal
        kind="tb"
        asset={selectedPreviewTB}
        preview={selectedPreview}
        loading={previewLoading}
        error={previewError}
        onClose={handleClosePreview}
        onRetry={() => {
          if (previewTBId) {
            void handleOpenPreview(previewTBId, true);
          }
        }}
      />

      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text">TB Management</h1>
            <p className="text-sm text-text-muted mt-1">
              Manage reusable term bases for consistency.
            </p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            Create Term Base
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
            <h2 className="field-label !text-[10px] mb-4">Create New Term Base</h2>
            <div className="mb-4">
              <label className="field-label !text-[10px]">Type</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {CREATE_SOURCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCreateSource(option.value)}
                    className={`rounded-control border px-3 py-2 text-left transition-colors ${
                      createSource === option.value
                        ? 'border-brand bg-brand-soft text-brand'
                        : 'border-border/60 bg-surface text-text-muted hover:border-brand/40'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="block text-[10px] opacity-70">{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-4 gap-4 items-end">
              <div className="col-span-2">
                <label className="field-label !text-[10px]">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="field-input !px-3 !py-2 text-sm"
                  placeholder="e.g. Product Glossary"
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
                  Save
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-6 h-6 border-2 border-brand border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-sm text-text-faint">Loading term bases...</p>
          </div>
        ) : tbs.length === 0 ? (
          <div className="surface-card border-dashed p-12 text-center">
            <div className="text-3xl mb-4">📘</div>
            <h3 className="text-sm font-bold text-text mb-1">No term base found</h3>
            <p className="text-xs text-text-muted mb-6">
              Create one to enforce terminology consistency.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-brand text-sm font-semibold hover:underline"
            >
              + Create your first term base
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tbs.map((tb) => (
              <TBCard
                key={tb.id}
                tb={tb}
                onPreview={(tbId) => void handleOpenPreview(tbId)}
                onImport={(tbId) => void handleStartImport(tbId)}
                onSync={(target) => void handleSyncNow(target)}
                onDelete={(tbId) => void handleDelete(tbId)}
                onOpenLinkedFile={(filePath) => void handleOpenLinkedFile(filePath)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
