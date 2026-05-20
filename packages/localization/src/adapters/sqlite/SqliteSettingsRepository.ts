import { CATDatabase } from '@cat/db';
import type { SettingsRepository } from '../../ports';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: CATDatabase) {}

  getSetting(key: string): string | undefined {
    return this.db.getSetting(key);
  }

  setSetting(key: string, value: string | null): void {
    this.db.setSetting(key, value);
  }
}
