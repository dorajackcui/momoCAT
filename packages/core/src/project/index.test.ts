import { describe, expect, it } from 'vitest';
import {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  getBuiltinOpenAIProviderModel,
  isBuiltinProjectAIModel,
  isLegacyProjectAIModel,
  PROJECT_AI_MODELS,
  isProjectAIModel,
  normalizeProjectAIModel,
} from './index';

describe('Project AI Model Registry', () => {
  it('validates normalized project ai provider ids', () => {
    expect(isBuiltinProjectAIModel('builtin:openai:gpt-5-mini')).toBe(true);
    expect(isLegacyProjectAIModel('gpt-5-mini')).toBe(true);
    expect(isProjectAIModel('custom:provider:demo')).toBe(true);
    expect(isProjectAIModel(null)).toBe(false);
  });

  it('normalizes legacy values and preserves custom provider ids', () => {
    expect(normalizeProjectAIModel('gpt-5-mini')).toBe('builtin:openai:gpt-5-mini');
    expect(normalizeProjectAIModel('custom:provider:demo')).toBe('custom:provider:demo');
    expect(normalizeProjectAIModel(undefined)).toBe(DEFAULT_PROJECT_AI_MODEL);
  });

  it('keeps default provider inside supported builtins', () => {
    expect(PROJECT_AI_MODELS.includes(DEFAULT_PROJECT_AI_MODEL)).toBe(true);
  });

  it('maps builtin provider ids back to concrete model names', () => {
    expect(getBuiltinOpenAIProviderModel(DEFAULT_PROJECT_AI_MODEL)).toBe('gpt-5.4-mini');
    expect(getBuiltinOpenAIProviderModel('custom:provider:demo')).toBeUndefined();
    expect(BUILTIN_OPENAI_PROVIDER_MODELS['builtin:openai:gpt-5']).toBe('gpt-5');
  });
});
