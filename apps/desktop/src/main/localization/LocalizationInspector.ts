import { writeFile } from 'fs/promises';
import { basename, extname, join, parse } from 'path';
import type { Segment } from '@cat/core/models';
import type { Project, ProjectType } from '@cat/core/project';
import { TagValidator } from '@cat/core/qa';
import type { CATDatabase } from '@cat/db';
import { TBService } from '../services/TBService';
import { TMService } from '../services/TMService';
import { SqliteProjectRepository } from '../services/adapters/SqliteProjectRepository';
import { SqliteSettingsRepository } from '../services/adapters/SqliteSettingsRepository';
import { SqliteTBRepository } from '../services/adapters/SqliteTBRepository';
import { SqliteTMRepository } from '../services/adapters/SqliteTMRepository';
import { DefaultAIRuntimeConfigProvider } from '../services/modules/ai/AIRuntimeConfigService';
import { AIProviderCatalogService } from '../services/modules/ai/AIProviderCatalogService';
import { AIProviderTransport } from '../services/providers/AIProviderTransport';
import type { AIRuntimeConfigProvider, AITransport } from '../services/ports';
import type {
  FileParseRowArtifact,
  InspectArtifact,
  InspectTruncatedFields,
  InspectUnitArtifact,
  PromptArtifact,
  TBArtifact,
  TMArtifact,
} from './artifacts';
import { MTModule } from './modules/MTModule';
import { TBModule } from './modules/TBModule';
import { parseExternalSpreadsheet, writeInspectSpreadsheet } from './modules/FileModule';
import { TMModule } from './modules/TMModule';
import { createTransientSegment } from './transientSegment';
import type { LocalizationEngineOptions, LocalizationMode, TranslateFileInput } from './types';

const DEFAULT_MAX_CELL_CHARS = 30000;

export interface InspectFileInput extends TranslateFileInput {
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
}

export interface InspectFileResult {
  artifact: InspectArtifact;
  outputPath: string;
  jsonOutputPath: string;
  summary: { total: number; ready: number; error: number };
}

export interface LocalizationInspectorOptions extends LocalizationEngineOptions {
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  tmModule?: TMModule;
  tbModule?: TBModule;
  mtModule?: Pick<MTModule, 'composePrompt'>;
}

type ProjectRecord = NonNullable<ReturnType<SqliteProjectRepository['getProject']>>;

export class LocalizationInspector {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly mtModule: Pick<MTModule, 'composePrompt'>;
  private readonly options: LocalizationInspectorOptions;

  constructor(db: CATDatabase, options: LocalizationInspectorOptions) {
    this.options = options;
    this.projectRepo = new SqliteProjectRepository(db);

    const settingsRepo = new SqliteSettingsRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const tmService = new TMService(this.projectRepo, tmRepo);
    const tbService = new TBService(this.projectRepo, tbRepo);
    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    const providerCatalogService = new AIProviderCatalogService(settingsRepo, aiTransport);
    const aiRuntimeConfigProvider =
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider();

    this.tmModule =
      options.tmModule ??
      new TMModule({
        tmRepo,
        tmService,
      });
    this.tbModule =
      options.tbModule ??
      new TBModule({
        tbRepo,
        tbService,
      });
    this.mtModule =
      options.mtModule ??
      new MTModule({
        providerCatalogService,
        aiRuntimeConfigProvider,
        aiTransport,
        tagValidator: new TagValidator(),
      });
  }

  async inspectFile(input: InspectFileInput): Promise<InspectFileResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const mode = this.resolveMode(input.options?.mode);
    if (mode === 'dialogue') {
      throw new Error('Dialogue mode is not supported for external localization inspection.');
    }

    const parsed = await parseExternalSpreadsheet(input);
    const maxCellChars = input.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
    const jsonOutputPath = input.jsonOutputPath ?? inferJsonOutputPath(input.outputPath);
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const limitedRows =
      input.unitLimit === undefined ? sourceRows : sourceRows.slice(0, Math.max(0, input.unitLimit));

    const units: InspectUnitArtifact[] = [];
    for (const [index, row] of limitedRows.entries()) {
      const segment = createTransientSegment(rowToUnit(row, project, parsed.inputPath), index, {
        projectId: project.id,
        sourceLanguage: project.srcLang,
        targetLanguage: project.tgtLang,
        fileName: basename(parsed.inputPath),
      });
      units.push(await this.inspectRow(project, row, segment, maxCellChars));
    }

    const firstReadyPrompt = units.find((unit) => unit.status === 'ready')?.mt.systemPrompt ?? '';
    const truncatedSystemPrompt = truncateForCell(
      firstReadyPrompt,
      maxCellChars,
      '#/systemPrompt/value',
    );

    const artifact: InspectArtifact = {
      version: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        srcLang: project.srcLang,
        tgtLang: project.tgtLang,
        projectType: project.projectType ?? 'translation',
        promptChars: project.aiPrompt?.length ?? 0,
      },
      inputFile: parsed.artifact,
      systemPrompt: {
        value: firstReadyPrompt,
        promptChars: firstReadyPrompt.length,
        xlsxValue: truncatedSystemPrompt.value,
        truncated: truncatedSystemPrompt.truncated,
      },
      units,
    };

    await writeInspectSpreadsheet(parsed, artifact, input.outputPath);
    await writeFile(jsonOutputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    return {
      artifact,
      outputPath: input.outputPath,
      jsonOutputPath,
      summary: {
        total: units.length,
        ready: units.filter((unit) => unit.status === 'ready').length,
        error: units.filter((unit) => unit.status === 'error').length,
      },
    };
  }

  private resolveMode(mode?: LocalizationMode): LocalizationMode {
    return mode ?? this.options.defaultMode ?? 'standard';
  }

  private async inspectRow(
    project: ProjectRecord,
    row: FileParseRowArtifact,
    segment: Segment,
    maxCellChars: number,
  ): Promise<InspectUnitArtifact> {
    try {
      const [tm, tb] = await Promise.all([
        this.tmModule.inspect(project.id, segment),
        this.tbModule.inspect(project.id, segment),
      ]);
      const mt = await this.mtModule.composePrompt({
        unitId: row.unitId,
        project,
        segment,
        tm,
        tb,
        mtOptions: this.options.mt,
        providerOverride: this.options.mt?.providerId,
      });

      return {
        unit: row,
        transientSegment: segmentMetadata(segment),
        tm,
        tb,
        mt,
        xlsx: buildXlsxFields(mt, row.unitId, maxCellChars),
        status: 'ready',
      };
    } catch (error) {
      return {
        unit: row,
        transientSegment: segmentMetadata(segment),
        tm: emptyTMArtifact(row.unitId, segment.segmentId),
        tb: emptyTBArtifact(row.unitId, segment.segmentId),
        mt: emptyPromptArtifact(row.unitId, project),
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
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function rowToUnit(row: FileParseRowArtifact, project: Project, inputPath: string) {
  return {
    id: row.unitId,
    source: row.source,
    target: row.target,
    sourceLanguage: project.srcLang,
    targetLanguage: project.tgtLang,
    context: row.context,
    fileName: basename(inputPath),
    rowNumber: row.rowNumber,
    metadata: {
      rowIndex: row.rowIndex,
      rowNumber: row.rowNumber,
    },
  };
}

function buildXlsxFields(
  mt: PromptArtifact,
  unitId: string,
  maxCellChars: number,
): InspectUnitArtifact['xlsx'] {
  const tmForMt = truncateForCell(mt.tmPromptBlock, maxCellChars, `#/units/${unitId}/mt/tmPromptBlock`);
  const tbForMt = truncateForCell(mt.tbPromptBlock, maxCellChars, `#/units/${unitId}/mt/tbPromptBlock`);
  const mtUserPrompt = truncateForCell(mt.userPrompt, maxCellChars, `#/units/${unitId}/mt/userPrompt`);

  return {
    tmForMt: tmForMt.value,
    tbForMt: tbForMt.value,
    mtUserPrompt: mtUserPrompt.value,
    truncated: {
      tmForMt: tmForMt.truncated,
      tbForMt: tbForMt.truncated,
      mtUserPrompt: mtUserPrompt.truncated,
    },
  };
}

function truncateForCell(value: string, maxCellChars: number, jsonRef: string): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= maxCellChars) {
    return { value, truncated: false };
  }

  const marker = `[TRUNCATED: see ${jsonRef}]`;
  return {
    value: marker.length <= maxCellChars ? marker : marker.slice(0, maxCellChars),
    truncated: true,
  };
}

function segmentMetadata(segment: Segment): InspectUnitArtifact['transientSegment'] {
  return {
    segmentId: segment.segmentId,
    matchKey: segment.matchKey,
    srcHash: segment.srcHash,
    tagsSignature: segment.tagsSignature,
  };
}

function emptyTMArtifact(unitId: string, segmentId: string): TMArtifact {
  return {
    unitId,
    segmentId,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: {
      tmReferences: [],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 0,
      maxConcordanceReferences: 0,
    },
    diagnostics: [],
  };
}

function emptyTBArtifact(unitId: string, segmentId: string): TBArtifact {
  return {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: {
      maxTbReferences: 0,
    },
    diagnostics: [],
  };
}

function emptyPromptArtifact(unitId: string, project: Pick<Project, 'projectType'>): PromptArtifact {
  return {
    unitId,
    provider: {
      id: null,
      name: null,
      baseUrl: null,
    },
    model: null,
    reasoningEffort: null,
    projectPrompt: '',
    projectType: (project.projectType ?? 'translation') as ProjectType,
    sourcePayload: '',
    tmPromptBlock: '',
    tbPromptBlock: '',
    systemPrompt: '',
    userPrompt: '',
    promptChars: {
      system: 0,
      user: 0,
      total: 0,
    },
  };
}

function inferJsonOutputPath(outputPath: string): string {
  const parsed = parse(outputPath);
  const name = extname(outputPath) ? parsed.name : parsed.base;
  return join(parsed.dir, `${name}.json`);
}
