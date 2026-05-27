import { CATDatabase } from '@cat/db';

export const RUNTIME_TM_NAME = 'Runtime TM';

export interface RuntimeTMDatabase {
  db: CATDatabase;
  projectId: number;
  tmId: string;
}

export function createRuntimeTMDatabase(input: {
  srcLang: string;
  tgtLang: string;
}): RuntimeTMDatabase {
  const db = new CATDatabase(':memory:');
  const projectId = db.createProject(RUNTIME_TM_NAME, input.srcLang, input.tgtLang, 'custom');
  const tmId = db.createTM(RUNTIME_TM_NAME, input.srcLang, input.tgtLang, 'working');

  db.mountTMToProject(projectId, tmId, 0, 'readwrite');

  return { db, projectId, tmId };
}
