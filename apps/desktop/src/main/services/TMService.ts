import {
  TMService as SharedTMService,
  type ConcordanceTMMatch,
  type StandardTMMatch,
  type TMMatch,
  type TMMatchBase,
  type TMMatchKind,
} from '@cat/localization';
import type { ProjectRepository, TMRepository } from './ports';

export type { ConcordanceTMMatch, StandardTMMatch, TMMatch, TMMatchBase, TMMatchKind };

export class TMService extends SharedTMService {
  constructor(projectRepo: ProjectRepository, tmRepo: TMRepository) {
    super(projectRepo, tmRepo);
  }
}
