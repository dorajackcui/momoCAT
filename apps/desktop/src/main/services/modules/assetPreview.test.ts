import { describe, expect, it, vi } from 'vitest';
import type { TBEntry, TMEntry } from '@cat/core/models';
import { TMModule } from './TMModule';
import { TBModule } from './TBModule';
import type {
  ProjectRepository,
  SegmentRepository,
  TBRepository,
  TMRepository,
  TransactionManager,
} from '../ports';
import { TMService } from '../TMService';
import { TBService } from '../TBService';
import { SegmentService } from '../SegmentService';

const tx = {
  runInTransaction: <T>(fn: () => T) => fn(),
} as TransactionManager;

function makeTMEntry(index: number): TMEntry {
  return {
    id: `tm-entry-${index}`,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'zh',
    srcHash: `hash-${index}`,
    matchKey: `source ${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `Source ${index}` }],
    targetTokens: [{ type: 'text', content: `Target ${index}` }],
    createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    updatedAt: `2026-01-02T00:00:${String(index).padStart(2, '0')}.000Z`,
    usageCount: index,
  };
}

function makeTBEntry(index: number): TBEntry {
  return {
    id: `tb-entry-${index}`,
    tbId: 'tb-1',
    srcLang: 'en',
    srcTerm: `Source term ${index}`,
    tgtTerm: `Target term ${index}`,
    srcNorm: `source term ${index}`,
    note: index === 0 ? 'Check language pair' : null,
    createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    updatedAt: `2026-01-02T00:00:${String(index).padStart(2, '0')}.000Z`,
    usageCount: index,
  };
}

describe('asset preview modules', () => {
  it('returns at most ten lightweight TM preview rows', async () => {
    const listTMEntries = vi.fn().mockReturnValue(
      Array.from({ length: 12 }, (_, index) => makeTMEntry(index)),
    );

    const module = new TMModule(
      {} as ProjectRepository,
      {} as SegmentRepository,
      { listTMEntries } as unknown as TMRepository,
      tx,
      {} as TMService,
      {} as SegmentService,
      ':memory:',
      vi.fn(),
    );

    const preview = await module.getTMPreview('tm-1');

    expect(listTMEntries).toHaveBeenCalledWith('tm-1', 10, 0);
    expect(preview.rows).toHaveLength(10);
    expect(preview.rows[0]).toMatchObject({
      id: 'tm-entry-0',
      source: 'Source 0',
      target: 'Target 0',
      updatedAt: '2026-01-02T00:00:00.000Z',
      usageCount: 0,
    });
  });

  it('returns at most ten lightweight TB preview rows', async () => {
    const listTBEntries = vi.fn().mockReturnValue(
      Array.from({ length: 12 }, (_, index) => makeTBEntry(index)),
    );

    const module = new TBModule(
      { listTBEntries } as unknown as TBRepository,
      tx,
      {} as TBService,
      vi.fn(),
    );

    const preview = await module.getTBPreview('tb-1');

    expect(listTBEntries).toHaveBeenCalledWith('tb-1', 10, 0);
    expect(preview.rows).toHaveLength(10);
    expect(preview.rows[0]).toMatchObject({
      id: 'tb-entry-0',
      sourceTerm: 'Source term 0',
      targetTerm: 'Target term 0',
      note: 'Check language pair',
      updatedAt: '2026-01-02T00:00:00.000Z',
      usageCount: 0,
    });
  });
});
