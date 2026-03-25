import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_AI_MODEL,
  TagValidator,
  computeMatchKey,
  serializeTokensToEditorText,
} from './index';
import {
  DEFAULT_PROJECT_AI_MODEL as projectDefaultProjectAIModel,
} from './project';
import { TagValidator as qaTagValidator } from './qa';
import { computeMatchKey as textComputeMatchKey } from './text';
import { serializeTokensToEditorText as tagSerializeTokensToEditorText } from './tag';

describe('Root Barrel', () => {
  it('re-exports symbols from the new slice entrypoints', () => {
    expect(DEFAULT_PROJECT_AI_MODEL).toBe(projectDefaultProjectAIModel);
    expect(TagValidator).toBe(qaTagValidator);
    expect(computeMatchKey).toBe(textComputeMatchKey);
    expect(serializeTokensToEditorText).toBe(tagSerializeTokensToEditorText);
  });
});
