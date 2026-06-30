import { describe, expect, it } from 'vitest';
import type { InspectUnitArtifact, PromptArtifact } from './artifacts';
import { buildUnitXlsxFields } from './LocalizationInspectorArtifacts';

describe('buildUnitXlsxFields', () => {
  it('renders row-scoped TM, concordance, and TB references while preserving full prompt', () => {
    const mt = createPromptArtifact(
      [
        'FULL WINDOW PROMPT: row-2 and row-3',
        'Window TM includes Other Row',
        'Window concordance includes Other Concordance',
        'Window TB includes Other Term',
      ].join('\n'),
      {
        tmPromptBlock: 'window-level tm block with Other Row',
        concordancePromptBlock:
          'window-level concordance block with Other Concordance',
        tbPromptBlock: 'window-level tb block with Other Term',
      },
    );
    const unit = createReadyUnit({
      tmReferences: [
        {
          similarity: 100,
          tmName: 'Main TM Row 1',
          sourceText: 'Hello world',
          targetText: 'Bonjour le monde',
        },
      ],
      concordanceReferences: [
        {
          matchedSourceText: 'world',
          tmName: 'Concordance TM Row 1',
          sourceText: 'world settings',
          targetText: 'parametres monde',
        },
      ],
      tbReferences: [
        {
          srcTerm: 'world',
          tgtTerm: 'monde',
          note: 'Use the common noun.',
        },
      ],
    });

    const fields = buildUnitXlsxFields({
      mt,
      unit,
      unitIndex: 0,
      maxCellChars: 1000,
    });

    expect(fields.mtUserPrompt).toContain(
      'FULL WINDOW PROMPT: row-2 and row-3',
    );
    expect(fields.mtUserPrompt).toContain('Other Row');
    expect(fields.mtUserPrompt).toContain('Other Concordance');
    expect(fields.mtUserPrompt).toContain('Other Term');
    expect(fields.tmForMt).toContain('TM References');
    expect(fields.tmForMt).toContain(
      '1. 100% Main TM Row 1 | Hello world -> Bonjour le monde',
    );
    expect(fields.tmForMt).toContain('Concordance Suggestions');
    expect(fields.tmForMt).toContain(
      '1. world (Concordance TM Row 1) | world settings -> parametres monde',
    );
    expect(fields.tmForMt).not.toContain('Other Row');
    expect(fields.tmForMt).not.toContain('Other Concordance');
    expect(fields.tbForMt).toContain('Terminology References');
    expect(fields.tbForMt).toContain(
      '1. world -> monde (note: Use the common noun.)',
    );
    expect(fields.tbForMt).not.toContain('Other Term');
    expect(fields.truncated).toEqual({
      tmForMt: false,
      tbForMt: false,
      mtUserPrompt: false,
    });
  });

  it('truncates row-scoped reference columns with unit-specific json refs', () => {
    const unit = createReadyUnit({
      tmReferences: [
        {
          similarity: 99,
          tmName: 'Very Long Main TM Name',
          sourceText: 'A'.repeat(100),
          targetText: 'B'.repeat(100),
        },
      ],
      concordanceReferences: [],
      tbReferences: [
        {
          srcTerm: 'C'.repeat(100),
          tgtTerm: 'D'.repeat(100),
          note: 'E'.repeat(100),
        },
      ],
    });

    const fields = buildUnitXlsxFields({
      mt: createPromptArtifact('F'.repeat(100)),
      unit,
      unitIndex: 1,
      maxCellChars: 80,
    });

    expect(fields.tmForMt).toContain(
      '[TRUNCATED: see #/units/1/tm/selectedReferences]',
    );
    expect(fields.tbForMt).toContain(
      '[TRUNCATED: see #/units/1/tb/selectedReferences]',
    );
    expect(fields.mtUserPrompt).toContain(
      '[TRUNCATED: see #/units/1/mt/userPrompt]',
    );
    expect(fields.tmForMt.length).toBeLessThanOrEqual(80);
    expect(fields.tbForMt.length).toBeLessThanOrEqual(80);
    expect(fields.mtUserPrompt.length).toBeLessThanOrEqual(80);
    expect(fields.truncated).toEqual({
      tmForMt: true,
      tbForMt: true,
      mtUserPrompt: true,
    });
  });
});

function createPromptArtifact(
  userPrompt: string,
  overrides: Partial<
    Pick<
      PromptArtifact,
      'tmPromptBlock' | 'concordancePromptBlock' | 'tbPromptBlock'
    >
  > = {},
): PromptArtifact {
  return {
    unitId: 'inspect-window-1',
    provider: {
      id: 'provider:test',
      name: 'Test Provider',
      baseUrl: 'https://api.test/v1',
    },
    model: 'gpt-test',
    reasoningEffort: 'medium',
    projectPrompt: '',
    projectType: 'translation',
    sourcePayload: 'row-2: Hello world\nrow-3: Preferences',
    tmPromptBlock: overrides.tmPromptBlock ?? 'window-level tm block',
    concordancePromptBlock:
      overrides.concordancePromptBlock ?? 'window-level concordance block',
    tbPromptBlock: overrides.tbPromptBlock ?? 'window-level tb block',
    referencePromptBlock: 'window-level reference block',
    systemPrompt: 'system prompt',
    userPrompt,
    promptChars: {
      system: 'system prompt'.length,
      user: userPrompt.length,
      total: 'system prompt'.length + userPrompt.length,
    },
    batch: {
      mode: 'window',
      taskId: 'inspect-window-1',
      currentIds: ['row-2', 'row-3'],
      previousContextCount: 0,
      nextContextCount: 0,
    },
  };
}

function createReadyUnit(
  refs: Pick<
    InspectUnitArtifact['tm']['selectedReferences'],
    'tmReferences' | 'concordanceReferences'
  > & {
    tbReferences: InspectUnitArtifact['tb']['selectedReferences'];
  },
): InspectUnitArtifact {
  return {
    unit: {
      rowIndex: 1,
      rowNumber: 2,
      unitId: 'row-2',
      source: 'Hello world',
      target: '',
      originalCells: ['Hello world', ''],
    },
    transientSegment: {
      segmentId: 'row-2',
      matchKey: 'hello world',
      srcHash: 'hash-row-2',
      tagsSignature: '',
    },
    tm: {
      unitId: 'row-2',
      segmentId: 'row-2',
      mountedTMs: [],
      rawMatches: [],
      selectedReferences: {
        tmReferences: refs.tmReferences,
        concordanceReferences: refs.concordanceReferences,
      },
      selectionPolicy: {
        maxTmReferences: 3,
        maxConcordanceReferences: 2,
      },
      diagnostics: [],
    },
    tb: {
      unitId: 'row-2',
      segmentId: 'row-2',
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: refs.tbReferences,
      selectionPolicy: {
        maxTbReferences: 12,
      },
      diagnostics: [],
    },
    mt: createPromptArtifact(''),
    xlsx: {
      tmForMt: '',
      tbForMt: '',
      mtUserPrompt: '',
      truncated: {
        tmForMt: false,
        tbForMt: false,
        mtUserPrompt: false,
      },
    },
    status: 'ready',
  };
}
