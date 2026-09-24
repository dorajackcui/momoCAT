import { CATDatabase } from '@cat/db';
import { TransactionManager } from '../ports';

export class SqliteTransactionManager implements TransactionManager {
  constructor(private readonly db: CATDatabase) {}

  runInTransaction<T>(fn: () => T, mode: 'deferred' | 'immediate' = 'deferred'): T {
    let result!: T;
    this.db.runInTransaction(() => {
      result = fn();
    }, mode);
    return result;
  }
}
