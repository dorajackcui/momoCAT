import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { cloneCloudProject } from '@cat/db';
import type { CloudProject } from '@cat/cloud-contracts';
import { CloudConnection } from './CloudConnection';
import { CloudAccountSession } from './CloudAccountSession';
import { CloudProjectSession } from './CloudProjectSession';
import { internalProjectFilePath } from '../services/modules/projectFileStorage';

// The prototype cache stays intact. Its locally saved edits, rather than a
// newer remote snapshot, become the initial V2 draft on this device.
export async function migrateLegacyCloudProject(
  account: CloudAccountSession,
  connection: CloudConnection,
  id: string,
): Promise<number> {
  const remote = await connection.json<CloudProject>(`/v1/projects/${id}`);
  const legacy = new CloudProjectSession(remote, connection, join(dirname(account.directory), id));
  const createdDirectories: string[] = [];
  try {
    await legacy.open();
    const sourceFiles = legacy.db.listFiles(legacy.projectId);
    const projectId = cloneCloudProject(
      legacy.dbPath,
      account.dbPath,
      legacy.projectId,
      { uuid: id },
      (copyId, files) => {
        const destination = join(account.projectsDir, String(copyId));
        mkdirSync(destination, { recursive: true });
        createdDirectories.push(destination);
        for (const file of files) {
          const source = sourceFiles.find((original) => original.uuid === file.sourceUUID);
          if (!source) throw new Error('Original project file mapping is unavailable');
          copyFileSync(
            internalProjectFilePath(legacy.projectsDir, source),
            internalProjectFilePath(account.projectsDir, file),
          );
        }
      },
    );
    // Publishing remains an explicit Sync action, including after conversion.
    return projectId;
  } catch (error) {
    for (const directory of createdDirectories) rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    legacy.dispose();
  }
}
