import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { AIRuntimeConfigProvider, AiModelRuntimeConfig, ReasoningEffort } from '../../ports';

export interface AiRuntimeConfig {
  version: 1;
  models: Record<string, AiModelRuntimeConfig>;
}

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

const DEFAULT_MODEL_RUNTIME_CONFIG: AiModelRuntimeConfig = {
  reasoningEffort: 'medium',
};

function cloneModelRuntimeConfig(config: AiModelRuntimeConfig): AiModelRuntimeConfig {
  return {
    reasoningEffort: config.reasoningEffort,
  };
}

export function createDefaultAIRuntimeConfig(): AiRuntimeConfig {
  return {
    version: 1,
    models: {
      'gpt-5.4': cloneModelRuntimeConfig(DEFAULT_MODEL_RUNTIME_CONFIG),
      'gpt-5.4-mini': cloneModelRuntimeConfig(DEFAULT_MODEL_RUNTIME_CONFIG),
      'gpt-5': cloneModelRuntimeConfig(DEFAULT_MODEL_RUNTIME_CONFIG),
      'gpt-5-mini': cloneModelRuntimeConfig(DEFAULT_MODEL_RUNTIME_CONFIG),
    },
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return typeof value === 'string' && REASONING_EFFORTS.has(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : null;
}

function sanitizeModelConfig(
  model: string,
  value: unknown,
  warn: (message: string) => void,
): AiModelRuntimeConfig {
  const fallback =
    createDefaultAIRuntimeConfig().models[model] ?? cloneModelRuntimeConfig(DEFAULT_MODEL_RUNTIME_CONFIG);
  if (!value || typeof value !== 'object') {
    warn(`Invalid runtime config for model "${model}", using defaults.`);
    return fallback;
  }

  const record = value as Partial<AiModelRuntimeConfig>;
  const reasoningEffort = normalizeReasoningEffort(record.reasoningEffort);

  if (reasoningEffort === null) {
    warn(`Invalid runtime config for model "${model}", using defaults.`);
    return fallback;
  }

  return { reasoningEffort };
}

export function sanitizeAIRuntimeConfig(
  raw: unknown,
  warn: (message: string) => void,
): AiRuntimeConfig {
  const fallback = createDefaultAIRuntimeConfig();
  if (!raw || typeof raw !== 'object') {
    warn('Invalid AI runtime config root, using defaults.');
    return fallback;
  }

  const record = raw as {
    version?: unknown;
    models?: Record<string, unknown>;
  };

  if (record.version !== 1) {
    warn('Unsupported AI runtime config version, using defaults.');
    return fallback;
  }

  if (!record.models || typeof record.models !== 'object') {
    warn('Missing AI runtime config models object, using defaults.');
    return fallback;
  }

  const models = Object.fromEntries(
    Object.entries(record.models).map(([model, value]) => [
      model,
      sanitizeModelConfig(model, value, warn),
    ]),
  );

  return { version: 1, models };
}

export class DefaultAIRuntimeConfigProvider implements AIRuntimeConfigProvider {
  private readonly config = createDefaultAIRuntimeConfig();

  public async getModelConfig(model: string): Promise<AiModelRuntimeConfig> {
    return cloneModelRuntimeConfig(this.config.models[model] ?? DEFAULT_MODEL_RUNTIME_CONFIG);
  }
}

export class AIRuntimeConfigService implements AIRuntimeConfigProvider {
  private cachedConfig: AiRuntimeConfig | null = null;

  constructor(
    private readonly filePath: string,
    private readonly logger: Pick<Console, 'warn'> = console,
  ) {}

  public async initialize(): Promise<AiRuntimeConfig> {
    const config = await this.loadOrCreateConfig();
    this.cachedConfig = config;
    return config;
  }

  public async getModelConfig(model: string): Promise<AiModelRuntimeConfig> {
    const config = this.cachedConfig ?? (await this.initialize());
    return cloneModelRuntimeConfig(config.models[model] ?? DEFAULT_MODEL_RUNTIME_CONFIG);
  }

  private async loadOrCreateConfig(): Promise<AiRuntimeConfig> {
    let rawContent: string;
    try {
      rawContent = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        const config = createDefaultAIRuntimeConfig();
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        return config;
      }
      throw error;
    }

    try {
      return sanitizeAIRuntimeConfig(JSON.parse(rawContent), (message) =>
        this.logger.warn(`[AI Runtime Config] ${message}`),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[AI Runtime Config] Failed to parse config file: ${message}`);
      return createDefaultAIRuntimeConfig();
    }
  }
}
