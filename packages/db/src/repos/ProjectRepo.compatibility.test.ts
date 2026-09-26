import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ensureCurrentSchema } from '../currentSchema';
import { ProjectRepo } from './ProjectRepo';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture(prompt: string | null) {
  const db = new Database(':memory:');
  databases.push(db);
  ensureCurrentSchema(db);
  db.prepare(
    "INSERT INTO projects (uuid, name, srcLang, tgtLang, projectType, aiPrompt) VALUES ('old-project', 'Existing work', 'en', 'fr', 'review', ?)",
  ).run(prompt);
  return { db, repo: new ProjectRepo(db) };
}

describe('retired Review project compatibility', () => {
  it.each([null, 'Only fix terminology.'])(
    'reads legacy rows as Custom without rewriting stored data (%s)',
    (prompt) => {
      const { db, repo } = fixture(prompt);
      const before = db.prepare('SELECT * FROM projects').get();
      db.prepare(
        "INSERT INTO files (uuid, projectId, name) VALUES ('existing-file', 1, 'existing.xlsx')",
      ).run();
      const project = repo.getProject(1)!;
      expect(repo.getProjectTypeByFileId(1)).toBe('custom');
      expect(project.projectType).toBe('custom');
      expect(project.aiPrompt).toContain(prompt ?? 'Review and improve the provided fr text');
      expect(repo.listProjects()).toEqual([project]);
      expect(db.prepare('SELECT * FROM projects').get()).toEqual(before);
      expect(db.prepare('SELECT COUNT(*) AS count FROM tms').get()).toEqual({ count: 0 });
    },
  );

  it.each(['prompt', 'settings'] as const)(
    'persists the conversion on %s save without repeating language instructions',
    (kind) => {
      const { db, repo } = fixture('Only fix terminology.');
      const prompt = repo.getProject(1)!.aiPrompt!;
      const save = () =>
        kind === 'prompt'
          ? repo.updateProjectPrompt(1, prompt)
          : repo.updateProjectAISettings(1, prompt, null);
      save();
      save();
      expect(db.prepare('SELECT projectType, aiPrompt FROM projects').get()).toEqual({
        projectType: 'custom',
        aiPrompt: prompt,
      });
      expect(repo.getProject(1)!.aiPrompt).toBe(prompt);
      repo.updateProjectPrompt(1, 'Classify the input.');
      expect(repo.getProject(1)!.aiPrompt).toBe('Classify the input.');
    },
  );

  it('rejects creation of retired project types', () => {
    const { repo } = fixture(null);
    expect(() => repo.createProject('New', 'en', 'fr', 'review' as never)).toThrow(
      'translation or custom',
    );
  });
});
