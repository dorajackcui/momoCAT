import { Button, Input, ChoiceGroup } from './ui';
import React, { useState, useEffect } from 'react';
import { TMImportWizard, type TMWizardMode } from './TMImportWizard';
import { AssetPreviewPage } from './AssetPreviewPage';
import { LanguageSelect } from './LanguageSelect';
import { apiClient } from '../services/apiClient';
import { feedbackService } from '../services/feedbackService';
import { DEFAULT_ASSET_SOURCE_LANG, DEFAULT_ASSET_TARGET_LANG } from './languageOptions';
import {
  confirmTMSyncLink,
  pickTMSyncSource,
  runTMSyncNow,
  tmSyncReportMessage,
  TM_SPREADSHEET_FILTERS,
} from './tm-manager/tmSyncActions';
import { TMCard } from './tm-manager/TMCard';
import type {
  ImportExecutionResult,
  SpreadsheetPreviewData,
  StructuredJobError,
  TMAssetPreview,
  TMImportOptions,
  TMSyncReport,
  TMWithStats,
} from '../../../shared/ipc';
import { TM_SYNC_MAPPING_REVIEW_REQUIRED } from '../../../shared/ipc';

type ImportNotice = {
  tone: 'success' | 'error';
  message: string;
};

type CreateSource = 'upload' | 'sync';

const CREATE_SOURCE_OPTIONS: Array<{ value: CreateSource; label: string; hint: string }> = [
  { value: 'upload', label: 'Standard TM', hint: 'Update by uploading Excel files' },
  { value: 'sync', label: 'Sync with Excel', hint: 'Mirror a linked local file' },
];

export const TMManager: React.FC = () => {
  const [tms, setTMs] = useState<TMWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSrc, setNewSrc] = useState(DEFAULT_ASSET_SOURCE_LANG);
  const [newTgt, setNewTgt] = useState(DEFAULT_ASSET_TARGET_LANG);
  const [createSource, setCreateSource] = useState<CreateSource>('upload');

  // Import / sync wizard state
  const [wizardMode, setWizardMode] = useState<TMWizardMode>('import');
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

  const handleOpenLinkedFile = async (filePath: string) => {
    try {
      await apiClient.openLocalFile(filePath);
    } catch (error) {
      feedbackService.error(
        `Failed to open linked file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const selectedPreviewTM = previewTMId ? (tms.find((tm) => tm.id === previewTMId) ?? null) : null;
  const selectedPreview = previewTMId ? (previewCache[previewTMId] ?? null) : null;

  const clearPreviewCache = (tmId: string) => {
    setPreviewCache((current) => {
      const next = { ...current };
      delete next[tmId];
      return next;
    });
  };

  const resetWizardState = () => {
    setIsImportWizardOpen(false);
    setImportJobId(null);
    setImportingTMId(null);
    setImportFilePath(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    let tmId: string;
    try {
      tmId = await apiClient.createTM(newName.trim(), newSrc, newTgt, 'main');
      setNewName('');
      setShowCreate(false);
      await loadTMs();
    } catch {
      feedbackService.error('Failed to create TM');
      return;
    }

    // A synced TM is unusable without its file binding, so link it right away.
    if (createSource === 'sync') {
      await handleStartLink(tmId);
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

  const handleRename = async (tmId: string, name: string) => {
    try {
      await apiClient.renameTM(tmId, name);
      setTMs((current) => current.map((tm) => (tm.id === tmId ? { ...tm, name } : tm)));
    } catch (error) {
      feedbackService.error(
        `Failed to rename TM: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  };

  const handleStartImport = async (tmId: string) => {
    setImportNotice(null);
    const filePath = await apiClient.openFileDialog(TM_SPREADSHEET_FILTERS);
    if (!filePath) return;

    try {
      const preview = await apiClient.getTMImportPreview(filePath);
      setWizardMode('import');
      setImportingTMId(tmId);
      setImportFilePath(filePath);
      setImportPreview(preview);
      setIsImportWizardOpen(true);
    } catch {
      feedbackService.error('Failed to read file for preview');
    }
  };

  const handleStartLink = async (tmId: string) => {
    setImportNotice(null);
    const picked = await pickTMSyncSource({
      openFileDialog: apiClient.openFileDialog,
      getTMImportPreview: apiClient.getTMImportPreview,
      error: feedbackService.error,
    });
    if (!picked) return;

    setWizardMode('sync');
    setImportingTMId(tmId);
    setImportFilePath(picked.filePath);
    setImportPreview(picked.preview);
    setIsImportWizardOpen(true);
  };

  const handleSyncNow = async (tm: TMWithStats) => {
    setImportNotice(null);
    const outcome = await runTMSyncNow(tm, {
      syncTMWithExcel: apiClient.syncTMWithExcel,
      confirmRelink: feedbackService.confirm,
      error: feedbackService.error,
    });

    if (outcome.kind === 'started') {
      setWizardMode('sync');
      setImportingTMId(tm.id);
      setImportFilePath(tm.syncConfig?.filePath ?? null);
      setImportPreview([]);
      setIsImportWizardOpen(true);
      setImportJobId(outcome.jobId);
    } else if (outcome.kind === 'relink-requested') {
      await handleStartLink(tm.id);
    }
  };

  const handleCancelSync = () => {
    if (!importingTMId || !importJobId) return;
    void apiClient.cancelTMSync(importingTMId, importJobId).catch(() => {
      feedbackService.error('Failed to cancel the sync.');
    });
  };

  const handleConfirmImport = async (options: TMImportOptions) => {
    if (!importingTMId || !importFilePath) return;

    if (wizardMode === 'sync') {
      const result = await confirmTMSyncLink(importingTMId, importFilePath, options, {
        setTMSyncConfig: apiClient.setTMSyncConfig,
        syncTMWithExcel: apiClient.syncTMWithExcel,
        error: feedbackService.error,
      });
      if (!result || result.status !== 'started') {
        resetWizardState();
        if (result?.status === 'file-missing') {
          feedbackService.error(`The linked Excel file could not be read: ${result.filePath}`);
        }
        return;
      }
      setImportJobId(result.jobId);
      return;
    }

    try {
      const jobId = await apiClient.importTMEntries(importingTMId, importFilePath, options);
      setImportJobId(jobId);
    } catch (error) {
      setImportNotice({
        tone: 'error',
        message: `Failed to start import: ${error instanceof Error ? error.message : String(error)}`,
      });
      resetWizardState();
    }
  };

  const handleImportCompleted = (result: ImportExecutionResult, report?: TMSyncReport) => {
    const completedTMId = importingTMId;
    setImportNotice({
      tone: 'success',
      message: report
        ? tmSyncReportMessage(report)
        : `Import completed: ${result.success} imported, ${result.skipped} skipped.`,
    });
    resetWizardState();
    if (completedTMId) {
      clearPreviewCache(completedTMId);
    }
    void loadTMs();
  };

  const handleImportFailed = async (error: StructuredJobError) => {
    const failedTMId = importingTMId;
    const mappingReviewRequired =
      wizardMode === 'sync' && error.code === TM_SYNC_MAPPING_REVIEW_REQUIRED;
    setImportNotice({
      tone: 'error',
      message:
        wizardMode === 'sync'
          ? `Sync failed (${error.code}): ${error.message}`
          : `Import failed (${error.code}): ${error.message}`,
    });
    resetWizardState();
    void loadTMs();
    if (mappingReviewRequired && failedTMId) {
      const relink = await feedbackService.confirm(
        `${error.message}\n\nReview the source/target mapping now?`,
      );
      if (relink) {
        await handleStartLink(failedTMId);
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 p-6 bg-canvas overflow-y-auto custom-scrollbar">
      <TMImportWizard
        isOpen={isImportWizardOpen}
        previewData={importPreview}
        jobId={importJobId}
        mode={wizardMode}
        onCancelSync={handleCancelSync}
        onClose={() => {
          if (importJobId) return;
          resetWizardState();
        }}
        onConfirm={handleConfirmImport}
        onJobCompleted={handleImportCompleted}
        onJobFailed={handleImportFailed}
      />
      <AssetPreviewPage
        kind="tm"
        asset={selectedPreviewTM}
        preview={selectedPreview}
        loading={previewLoading}
        error={previewError}
        onBack={handleClosePreview}
        onRetry={() => {
          if (previewTMId) {
            void handleOpenPreview(previewTMId, true);
          }
        }}
      />

      <div className="max-w-6xl mx-auto" hidden={selectedPreviewTM !== null}>
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-text">Translation memory</h1>
            <p className="text-sm text-text-muted mt-1">Manage your Main TMs</p>
          </div>
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            Create Main TM
          </Button>
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
              <Button
                tone="inherit"
                variant="link"
                type="button"
                onClick={() => setImportNotice(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="mb-8 p-6 surface-card animate-in fade-in slide-in-from-top-4">
            <h2 className="field-label !text-[10px] mb-4">Create New Main TM</h2>
            <div className="mb-4">
              <label className="field-label !text-[10px]">Type</label>
              <ChoiceGroup
                label="TM creation type"
                variant="cards"
                value={createSource}
                onValueChange={setCreateSource}
                options={CREATE_SOURCE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.hint,
                }))}
                className="mt-1"
              />
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-4 gap-4 items-end">
              <div className="col-span-2">
                <label className="field-label !text-[10px]">TM Name</label>
                <Input
                  size="compact"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Technical Glossary"
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label !text-[10px]">Source</label>
                <LanguageSelect size="compact" value={newSrc} onChange={setNewSrc} />
              </div>
              <div>
                <label className="field-label !text-[10px]">Target</label>
                <LanguageSelect size="compact" value={newTgt} onChange={setNewTgt} />
              </div>
              <div className="col-span-4 flex justify-end gap-2 mt-2">
                <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" className="min-w-24">
                  Save TM
                </Button>
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
            <Button tone="brand" variant="link" onClick={() => setShowCreate(true)}>
              + Create your first Main TM
            </Button>
          </div>
        ) : (
          <div className="workspace-resource-grid">
            {tms.map((tm) => (
              <TMCard
                key={tm.id}
                tm={tm}
                onPreview={(tmId) => void handleOpenPreview(tmId)}
                onImport={(tmId) => void handleStartImport(tmId)}
                onSync={(target) => void handleSyncNow(target)}
                onRename={handleRename}
                onDelete={(tmId) => void handleDelete(tmId)}
                onOpenLinkedFile={(filePath) => void handleOpenLinkedFile(filePath)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
