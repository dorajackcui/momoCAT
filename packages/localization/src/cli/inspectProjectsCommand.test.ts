import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATDatabase } from '../../../db/src';
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
  db.updateProjectAISettings(projectId, 'Use concise style.', 'custom:test-provider');
  db.setSetting(
    'ai_provider_catalog_v1',
    JSON.stringify([
      {
        id: 'custom:test-provider',
        name: 'Test Provider',
        baseUrl: 'https://example.invalid/v1/',
        model: 'test-model',
        protocol: 'chat-completions',
        kind: 'custom',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  );
  db.setSetting('ai_provider_key::custom:test-provider', 'sk-test-1234567890');

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
        {
          id: 'custom:test-provider',
          name: 'Test Provider',
          baseUrl: 'https://example.invalid/v1',
          model: 'test-model',
          kind: 'custom',
          apiKeySet: true,
          apiKeyLast4: '7890',
        },
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
      expect(result.projects[0].model.id).toBe('custom:test-provider');
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
      expect(JSON.stringify(result)).not.toContain('sk-test-1234567890');
      expect(JSON.stringify(result)).toContain('"apiKeyLast4":"7890"');
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
});
