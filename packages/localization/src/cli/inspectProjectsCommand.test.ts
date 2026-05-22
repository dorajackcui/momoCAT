import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import { runInspectProjectsCommand } from './inspectProjectsCommand';

function createSegment(
  fileId: number,
  index: number,
  targetText: string,
  status: Segment['status'],
): Segment {
  return {
    segmentId: `seg-${index}`,
    fileId,
    orderIndex: index,
    sourceTokens: [{ type: 'text', content: `Source ${index}` }],
    targetTokens: targetText ? [{ type: 'text', content: targetText }] : [],
    status,
    tagsSignature: '',
    matchKey: `source-${index}`,
    srcHash: `hash-${index}`,
    meta: {
      rowRef: index,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function createFixtureDb() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'momocat-inspect-projects-'),
  );
  const dbPath = path.join(tempRoot, 'cat_v1.db');
  const db = new CATDatabase(dbPath);

  const projectId = db.createProject(
    'Fixture Project',
    'en-US',
    'zh-CN',
    'translation',
  );
  db.updateProjectAISettings(projectId, 'Use concise style.', 'provider:gpt-demo');
  db.setSetting(
    'ai_connection_catalog_v1',
    JSON.stringify([
      {
        id: 'connection:openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        protocol: 'chat-completions',
        kind: 'openai-compatible',
        apiKeyLast4: '1234',
        discoveredModels: ['gpt-demo'],
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    ]),
  );
  db.setSetting('ai_connection_key::connection:openai', 'sk-test-1234');
  db.setSetting(
    'ai_provider_catalog_v2',
    JSON.stringify([
      {
        id: 'provider:gpt-demo',
        name: 'OpenAI / gpt-demo',
        connectionId: 'connection:openai',
        model: 'gpt-demo',
        protocol: 'chat-completions',
        kind: 'configured',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
      },
    ]),
  );

  const tmId = db.createTM('Client Main TM', 'en-US', 'zh-CN', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');
  const tbId = db.createTermBase('Client Terms', 'en-US', 'zh-CN');
  db.mountTermBaseToProject(projectId, tbId, 20);

  const fileId = db.createFile(projectId, 'fixture.xlsx');
  db.bulkInsertSegments([
    createSegment(fileId, 1, '', 'new'),
    createSegment(fileId, 2, 'Ni hao', 'translated'),
  ]);
  db.close();

  return { dbPath, projectId, tempRoot };
}

describe('runInspectProjectsCommand', () => {
  it('returns project, provider, mounted resource, file, and status summaries', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.dbPath).toBe(dbPath);
      expect(result.generatedAt).toBe('2026-05-21T00:00:00.000Z');
      expect(result.providers).toEqual([
        expect.objectContaining({
          id: 'provider:gpt-demo',
          name: 'OpenAI / gpt-demo',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-demo',
          kind: 'configured',
          apiKeySet: true,
          apiKeyLast4: '1234',
        }),
      ]);
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]).toMatchObject({
        id: projectId,
        name: 'Fixture Project',
        srcLang: 'en-US',
        tgtLang: 'zh-CN',
        projectType: 'translation',
        promptChars: 'Use concise style.'.length,
      });
      expect(result.projects[0].model).toMatchObject({
        id: 'provider:gpt-demo',
        model: 'gpt-demo',
      });
      expect(
        result.projects[0].mountedTMs.find((tm) => tm.name === 'Client Main TM'),
      ).toMatchObject({
        name: 'Client Main TM',
        isEnabled: true,
      });
      expect(result.projects[0].mountedTBs[0]).toMatchObject({
        name: 'Client Terms',
        isEnabled: true,
      });
      expect(result.projects[0].files[0]).toMatchObject({
        name: 'fixture.xlsx',
        totalSegments: 2,
        targetRows: 1,
        confirmedSegments: 0,
        statusCounts: {
          new: 1,
          translated: 1,
        },
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('filters by project id and never returns full API keys', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.projects.map((project) => project.id)).toEqual([projectId]);
      expect(JSON.stringify(result)).not.toContain('sk-test-1234');
      expect(JSON.stringify(result)).toContain('"apiKeyLast4":"1234"');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns no projects when a filtered project id is missing', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId: projectId + 1,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.projects).toEqual([]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to the first configured provider for legacy project model ids', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    const db = new CATDatabase(dbPath);
    try {
      db.updateProjectAISettings(
        projectId,
        'Use concise style.',
        'builtin:openai:gpt-5-mini',
      );
    } finally {
      db.close();
    }

    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.projects[0].model).toMatchObject({
        id: 'provider:gpt-demo',
        configuredId: 'builtin:openai:gpt-5-mini',
        fallbackFrom: 'builtin:openai:gpt-5-mini',
        resolvedId: 'provider:gpt-demo',
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not fall back when a configured provider id is missing', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    const db = new CATDatabase(dbPath);
    try {
      db.updateProjectAISettings(
        projectId,
        'Use concise style.',
        'provider:deleted',
      );
    } finally {
      db.close();
    }

    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.providers).toHaveLength(1);
      expect(result.projects[0].model).toMatchObject({
        id: 'provider:deleted',
        name: 'No configured AI provider',
        baseUrl: null,
        model: null,
        kind: 'configured',
        apiKeySet: false,
        apiKeyLast4: null,
        configuredId: 'provider:deleted',
        fallbackFrom: 'provider:deleted',
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('reports no configured AI provider when provider settings are absent', () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'momocat-inspect-projects-no-provider-'),
    );
    const dbPath = path.join(tempRoot, 'cat_v1.db');
    const db = new CATDatabase(dbPath);
    let projectId = 0;
    try {
      projectId = db.createProject('No Provider Project', 'en-US', 'zh-CN');
      db.updateProjectAISettings(projectId, null, 'provider:gpt-demo');
    } finally {
      db.close();
    }

    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });

      expect(result.providers).toEqual([]);
      expect(result.projects[0].model).toMatchObject({
        id: 'provider:gpt-demo',
        name: 'No configured AI provider',
        baseUrl: null,
        model: null,
        kind: 'configured',
        apiKeySet: false,
        apiKeyLast4: null,
        configuredId: 'provider:gpt-demo',
        fallbackFrom: 'provider:gpt-demo',
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('throws for a missing db path without creating a database file', () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'momocat-inspect-projects-missing-'),
    );
    const dbPath = path.join(tempRoot, 'missing.db');
    try {
      expect(() =>
        runInspectProjectsCommand({
          dbPath,
          generatedAt: () => '2026-05-21T00:00:00.000Z',
        }),
      ).toThrow();
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('aggregates file status counts across bounded segment pages', () => {
    const { dbPath, projectId, tempRoot } = createFixtureDb();
    const db = new CATDatabase(dbPath);
    let fileId = 0;
    try {
      fileId = db.createFile(projectId, 'paged.xlsx');
      db.bulkInsertSegments(
        Array.from({ length: 1001 }, (_, index) => {
          const row = index + 1;
          return createSegment(
            fileId,
            row + 100,
            index % 2 === 0 ? `Target ${row}` : '',
            index % 3 === 0 ? 'confirmed' : 'translated',
          );
        }),
      );
    } finally {
      db.close();
    }

    const pageSpy = vi.spyOn(CATDatabase.prototype, 'getSegmentsPage');
    try {
      const result = runInspectProjectsCommand({
        dbPath,
        projectId,
        generatedAt: () => '2026-05-21T00:00:00.000Z',
      });
      const file = result.projects[0].files.find((entry) => entry.name === 'paged.xlsx');

      expect(file).toMatchObject({
        totalSegments: 1001,
        targetRows: 501,
        statusCounts: {
          confirmed: 334,
          translated: 667,
        },
      });
      const pagedFileCalls = pageSpy.mock.calls.filter(([calledFileId]) => calledFileId === fileId);
      expect(pagedFileCalls.map(([, offset, limit]) => [offset, limit])).toEqual([
        [0, 500],
        [500, 500],
        [1000, 500],
        [1500, 500],
      ]);
    } finally {
      pageSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
