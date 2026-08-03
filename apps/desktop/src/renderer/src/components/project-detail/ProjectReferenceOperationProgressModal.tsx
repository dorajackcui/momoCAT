import type { ReferenceOperationProgress } from './useProjectReferenceActions';
import { Spinner } from '../ui';

interface ProjectReferenceOperationProgressModalProps {
  progress: ReferenceOperationProgress | null;
}

export function ProjectReferenceOperationProgressModal({
  progress,
}: ProjectReferenceOperationProgressModalProps) {
  if (!progress) return null;

  const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="modal-backdrop !z-[100]">
      <div className="modal-card max-w-sm p-6 text-center animate-in fade-in zoom-in duration-200">
        <div className="mb-4">
          <div className="w-12 h-12 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-3">
            <Spinner size="lg" tone="brand" />
          </div>
          <h2 className="text-lg font-bold text-text">
            {progress.kind === 'precheck'
              ? 'Extracting source terms...'
              : 'Exporting TM/TB refs...'}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Processing row {progress.current} of {progress.total}
          </p>
        </div>
        <div className="overflow-hidden h-2 rounded bg-brand-soft">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
