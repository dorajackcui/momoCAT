import type { TMRepository } from '../../ports';
import type { WorkingTMExportRunner } from './WorkingTMExportWorkerRunner';
import type { WorkingTMResetRunner } from './WorkingTMResetWorkerRunner';

export class WorkingTMService {
  constructor(
    private readonly tmRepo: TMRepository,
    private readonly exportRunner: WorkingTMExportRunner,
    private readonly resetRunner: WorkingTMResetRunner,
  ) {}

  public async exportToExcel(projectId: number, tmId: string, outputPath: string): Promise<number> {
    this.assertMountedWorkingTM(projectId, tmId);
    if (!outputPath.trim()) {
      throw new Error('Working TM export path cannot be empty.');
    }

    return this.exportRunner.run(tmId, outputPath);
  }

  public async reset(projectId: number, tmId: string): Promise<number> {
    this.assertMountedWorkingTM(projectId, tmId);
    return this.resetRunner.run(tmId);
  }

  private assertMountedWorkingTM(projectId: number, tmId: string): void {
    const mountedTM = this.tmRepo
      .getProjectMountedTMs(projectId)
      .find((tm) => tm.id === tmId && tm.type === 'working' && tm.permission === 'readwrite');

    if (!mountedTM) {
      throw new Error("The selected TM is not this project's writable Working TM.");
    }
  }
}
