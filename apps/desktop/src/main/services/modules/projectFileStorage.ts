import { join } from 'path';

interface InternalProjectFileRef {
  id: number;
  projectId: number;
  name: string;
}

export function internalProjectFilePath(projectsDir: string, file: InternalProjectFileRef): string {
  return join(projectsDir, file.projectId.toString(), `${file.id}_${file.name}`);
}
