import { describe, expect, it } from 'vitest';
import {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  buildAIDialogueUserPrompt,
  buildAISystemPrompt,
  buildAIUserPrompt,
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

  it('builds default translation system prompt when no custom prompt is provided', () => {
    const prompt = buildAISystemPrompt('translation', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: '',
    });

    expect(prompt).toContain('You are a professional translator.');
    expect(prompt).toContain('Translate from en to zh.');
  });

  it('builds default review system prompt when no custom prompt is provided', () => {
    const prompt = buildAISystemPrompt('review', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: '',
    });

    expect(prompt).toContain('You are a professional reviewer.');
    expect(prompt).toContain('Review and improve the provided zh text, using en as source language.');
  });

  it('builds default custom system prompt when no custom prompt is provided', () => {
    const prompt = buildAISystemPrompt('custom', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: '',
    });

    expect(prompt).toContain('You are a precise text processing assistant.');
    expect(prompt).toContain('Follow the user-provided instruction exactly.');
  });

  it('keeps translation and review prompt extension semantics, and custom override semantics', () => {
    const translationPrompt = buildAISystemPrompt('translation', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: 'Use concise style.',
    });
    const reviewPrompt = buildAISystemPrompt('review', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: 'Fix terminology only.',
    });
    const customPrompt = buildAISystemPrompt('custom', {
      srcLang: 'en',
      tgtLang: 'zh',
      projectPrompt: 'Classify sentiment as positive/negative.',
    });

    expect(translationPrompt).toContain('Use concise style.');
    expect(translationPrompt).toContain('Translate from en to zh.');
    expect(reviewPrompt).toContain('Original text language: en. Translation text language: zh.');
    expect(reviewPrompt).toContain('Fix terminology only.');
    expect(customPrompt).toBe('Classify sentiment as positive/negative.');
  });

  it('builds translation and dialogue user prompts with context and references', () => {
    const translationPrompt = buildAIUserPrompt('translation', {
      srcLang: 'en',
      sourcePayload: 'Hello world',
      hasProtectedMarkers: false,
      context: 'UI label',
      tmReference: {
        similarity: 98,
        tmName: 'Main TM',
        sourceText: 'Hello world',
        targetText: '你好世界',
      },
      tbReferences: [{ srcTerm: 'world', tgtTerm: '世界', note: 'prefer noun form' }],
    });
    const dialoguePrompt = buildAIDialogueUserPrompt({
      srcLang: 'en',
      tgtLang: 'zh',
      segments: [{ id: 'seg-1', speaker: 'Alice', sourcePayload: 'Hello there' }],
      previousGroup: {
        speaker: 'Bob',
        sourceText: 'Good morning',
        targetText: '早上好',
      },
    });

    expect(translationPrompt).toContain('Source (en):');
    expect(translationPrompt).toContain('Context: UI label');
    expect(translationPrompt).toContain('TM Reference (best match):');
    expect(translationPrompt).toContain('- world => 世界 (note: prefer noun form)');
    expect(dialoguePrompt).toContain('Return strict JSON only');
    expect(dialoguePrompt).toContain('Previous Dialogue Group (for consistency):');
    expect(dialoguePrompt).toContain('speaker: Bob');
  });
});
