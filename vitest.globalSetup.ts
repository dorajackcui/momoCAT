// Vitest globalSetup: make raw `npx vitest` invocations safe by ensuring
// better-sqlite3 is compiled for Node before any test loads it. With the
// ABI cache in ensure-sqlite-abi.mjs this is a no-op or a file copy in the
// common case, so it adds no meaningful startup cost.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function ensureSqliteAbi(): void {
  const repoRoot = dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'ensure-sqlite-abi.mjs'), 'node'],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('better-sqlite3 is not built for Node and could not be rebuilt');
  }
}
