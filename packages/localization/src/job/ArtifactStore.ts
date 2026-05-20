import type { ArtifactRecord } from './types';
import { appendJsonlRecord } from './JsonlStore';

export class ArtifactStore {
  constructor(private readonly filePath: string) {}

  async append(record: ArtifactRecord): Promise<void> {
    await appendJsonlRecord(this.filePath, record);
  }
}
