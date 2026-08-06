import type { Segment } from '@cat/core/models';
import type { TMConcordanceRecord, TMRepository } from '../../ports';
import { TMService } from '../../TMService';
import type { TMAssetPreview } from '../../../../shared/ipc';

const ASSET_PREVIEW_ROW_LIMIT = 10;

export class TMQueryService {
  constructor(
    private readonly tmRepo: TMRepository,
    private readonly tmService: TMService,
  ) {}

  public async findMatches(projectId: number, segment: Segment) {
    return this.tmService.findMatches(projectId, segment);
  }

  public async searchConcordance(projectId: number, query: string): Promise<TMConcordanceRecord[]> {
    const entries = this.tmRepo.searchConcordance(projectId, query);
    const mountedById = new Map(
      this.tmRepo.getProjectMountedTMs(projectId).map((tm) => [tm.id, tm] as const),
    );

    return entries.map((entry) => {
      const tm = mountedById.get(entry.tmId);
      return {
        ...entry,
        tmName: tm?.name ?? 'Unknown TM',
        tmType: tm?.type ?? 'main',
      };
    });
  }

  public async listTMs(type?: 'working' | 'main') {
    const tms = this.tmRepo.listTMs(type);
    return tms.map((tm) => ({
      ...tm,
      stats: this.tmRepo.getTMStats(tm.id),
    }));
  }

  public async getTMPreview(tmId: string): Promise<TMAssetPreview> {
    const entries = this.tmRepo.listTMEntries(tmId, ASSET_PREVIEW_ROW_LIMIT, 0);

    return {
      tmId,
      rows: entries.slice(0, ASSET_PREVIEW_ROW_LIMIT).map((entry) => ({
        id: entry.id,
        source: entry.sourceTokens.map((token) => token.content).join(''),
        target: entry.targetTokens.map((token) => token.content).join(''),
        updatedAt: entry.updatedAt,
        usageCount: entry.usageCount,
      })),
    };
  }

  public async createTM(
    name: string,
    srcLang: string,
    tgtLang: string,
    type: 'working' | 'main' = 'main',
  ) {
    return this.tmRepo.createTM(name, srcLang, tgtLang, type);
  }

  public async renameTM(tmId: string, name: string): Promise<void> {
    this.tmRepo.renameTM(tmId, name);
  }

  public async deleteTM(tmId: string) {
    this.tmRepo.deleteTM(tmId);
  }

  public async getProjectMountedTMs(projectId: number) {
    const mounted = this.tmRepo.getProjectMountedTMs(projectId);
    return mounted.map((tm) => ({
      ...tm,
      entryCount: this.tmRepo.getTMStats(tm.id).entryCount,
    }));
  }

  public async mountTMToProject(
    projectId: number,
    tmId: string,
    priority?: number,
    permission?: string,
  ) {
    this.tmRepo.mountTMToProject(projectId, tmId, priority, permission);
  }

  public async unmountTMFromProject(projectId: number, tmId: string) {
    this.tmRepo.unmountTMFromProject(projectId, tmId);
  }
}
