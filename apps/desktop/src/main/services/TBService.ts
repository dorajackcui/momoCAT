import { TBService as SharedTBService } from '@cat/localization';
import type { ProjectRepository, TBRepository } from './ports';

export class TBService extends SharedTBService {
  constructor(projectRepo: ProjectRepository, tbRepo: TBRepository) {
    super(projectRepo, tbRepo);
  }
}
