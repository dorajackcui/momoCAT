import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_AI_MODEL,
  PROJECT_AI_MODELS,
  isProjectAIModel,
  normalizeProjectAIModel,
} from './index';

describe('Project AI Model Registry', () => {
  it('validates known project AI models', () => {
    expect(isProjectAIModel('gpt-5-mini')).toBe(true);
    expect(isProjectAIModel('gpt-unknown')).toBe(false);
    expect(isProjectAIModel(null)).toBe(false);
  });

  it('normalizes unsupported model to default model', () => {
    expect(normalizeProjectAIModel('gpt-5-mini')).toBe('gpt-5-mini');
    expect(normalizeProjectAIModel('gpt-unknown')).toBe(DEFAULT_PROJECT_AI_MODEL);
    expect(normalizeProjectAIModel(undefined)).toBe(DEFAULT_PROJECT_AI_MODEL);
  });

  it('keeps default model inside supported model list', () => {
    expect(PROJECT_AI_MODELS.includes(DEFAULT_PROJECT_AI_MODEL)).toBe(true);
  });
});
