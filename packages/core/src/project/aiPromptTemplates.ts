import type {
  DialogueUserPromptBuildParams,
  SystemPromptBuildParams,
  UserPromptBuildParams,
} from './aiPromptTypes';

type ProjectType = 'translation' | 'review' | 'custom';

function buildTranslationBasePromptRules(srcLang: string, tgtLang: string): string[] {
  return [
    '',
    `From ${srcLang} to ${tgtLang}.`,
    'The source can include protected markers such as {1>, <2}, {3}.',
    // 'Never translate, remove, reorder, renumber, or rewrite protected markers.',
    // 'Keep all tags, placeholders, and formatting exactly as they appear in the source.',
    'Return only the translated text, without quotes or extra commentary.',
    'Do not copy the source text unless it is already in the target language.',
  ];
}

function buildTranslationSourceHeader(srcLang: string, hasProtectedMarkers: boolean): string {
  if (hasProtectedMarkers) {
    return `Source (${srcLang}, protected-marker format):`;
  }
  return `Source (${srcLang}):`;
}

function buildReviewBasePromptRules(srcLang: string, tgtLang: string): string[] {
  return [
    `Review and improve the provided ${tgtLang} text, using ${srcLang} as source language.`,
    'The source can include protected markers such as {1>, <2}, {3}.',
    'Never translate, remove, reorder, renumber, or rewrite protected markers.',
    'Keep all tags, placeholders, and formatting exactly as they appear in the source.',
    'Return only the reviewed text, without quotes or extra commentary.',
    'If no edit is needed, returning the original text is allowed.',
  ];
}

function buildReviewLanguageInstruction(srcLang: string, tgtLang: string): string {
  return `Original text language: ${srcLang}. Translation text language: ${tgtLang}.`;
}

function buildCustomSourceHeader(hasProtectedMarkers: boolean): string {
  if (hasProtectedMarkers) {
    return 'Input (protected-marker format):';
  }
  return 'Input:';
}

function buildTranslationSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  const base = buildTranslationBasePromptRules(params.srcLang, params.tgtLang).join('\n');

  if (!trimmedProjectPrompt) {
    return `You are a professional translator.\n${base}`;
  }

  return `${trimmedProjectPrompt}\n${base}`;
}

function buildTranslationUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [
    buildTranslationSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ];

  const contextText = typeof params.context === 'string' ? params.context.trim() : '';
  if (contextText) {
    userParts.push('', `Context: ${contextText}`);
  }

  const currentTranslationText =
    typeof params.currentTranslationPayload === 'string'
      ? params.currentTranslationPayload.trim()
      : '';
  const refinementInstructionText =
    typeof params.refinementInstruction === 'string' ? params.refinementInstruction.trim() : '';
  if (currentTranslationText && refinementInstructionText) {
    userParts.push(
      '',
      'Current Translation:',
      currentTranslationText,
      '',
      'Refinement Instruction:',
      refinementInstructionText,
    );
  }

  if (params.tmReference) {
    userParts.push(
      '',
      'TM Reference (best match):',
      `- Similarity: ${params.tmReference.similarity}% | TM: ${params.tmReference.tmName}`,
      `- Source: ${params.tmReference.sourceText}`,
      `- Target: ${params.tmReference.targetText}`,
    );
  }

  if (params.tbReferences && params.tbReferences.length > 0) {
    userParts.push('', 'Terminology References (hit terms):');
    for (const reference of params.tbReferences) {
      const note = typeof reference.note === 'string' ? reference.note.trim() : '';
      const noteSuffix = note ? ` (note: ${note})` : '';
      userParts.push(`- ${reference.srcTerm} => ${reference.tgtTerm}${noteSuffix}`);
    }
  }

  if (params.validationFeedback) {
    userParts.push('', 'Validation feedback from previous attempt:', params.validationFeedback);
  }

  return userParts.join('\n');
}

function buildReviewSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  const languageInstruction = buildReviewLanguageInstruction(params.srcLang, params.tgtLang);

  if (trimmedProjectPrompt) {
    return `${languageInstruction}\n${trimmedProjectPrompt}`;
  }

  const base = buildReviewBasePromptRules(params.srcLang, params.tgtLang).join('\n');
  return `You are a professional reviewer.\n${base}`;
}

function buildReviewUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [
    buildTranslationSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ];

  const contextText = typeof params.context === 'string' ? params.context.trim() : '';
  userParts.push('', `Context: ${contextText}`);

  if (params.validationFeedback) {
    userParts.push('', 'Validation feedback from previous attempt:', params.validationFeedback);
  }

  return userParts.join('\n');
}

function buildCustomSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  if (trimmedProjectPrompt) {
    return trimmedProjectPrompt;
  }

  return [
    'You are a precise text processing assistant.',
    'Follow the user-provided instruction exactly.',
    'Use context when present.',
    'Return only the final output text, without quotes or extra commentary.',
  ].join('\n');
}

function buildCustomUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [buildCustomSourceHeader(params.hasProtectedMarkers), params.sourcePayload];

  const contextText = typeof params.context === 'string' ? params.context.trim() : '';
  if (contextText) {
    userParts.push('', `Context: ${contextText}`);
  }

  if (params.validationFeedback) {
    userParts.push('', 'Validation feedback from previous attempt:', params.validationFeedback);
  }

  return userParts.join('\n');
}

function buildDialogueTranslationUserPrompt(params: DialogueUserPromptBuildParams): string {
  const userParts: string[] = [
    `Translate the following dialogue segments from ${params.srcLang} to ${params.tgtLang}.`,
    'Return strict JSON only with this schema:',
    '{"translations":[{"id":"<segment-id>","text":"<translated-text>"}]}',
    'Each output item must preserve its source id exactly.',
    'Never omit or add IDs.',
    '',
    'Dialogue Segments:',
  ];

  params.segments.forEach((segment, index) => {
    userParts.push(
      `${index + 1}. id: ${segment.id}`,
      `   speaker: ${segment.speaker}`,
      '   source:',
      segment.sourcePayload,
    );

    if (segment.tmReference) {
      userParts.push(
        '   TM Reference (best match):',
        `   - Similarity: ${segment.tmReference.similarity}% | TM: ${segment.tmReference.tmName}`,
        `   - Source: ${segment.tmReference.sourceText}`,
        `   - Target: ${segment.tmReference.targetText}`,
      );
    }

    if (segment.tbReferences && segment.tbReferences.length > 0) {
      userParts.push('   Terminology References (hit terms):');
      for (const reference of segment.tbReferences) {
        const note = typeof reference.note === 'string' ? reference.note.trim() : '';
        const noteSuffix = note ? ` (note: ${note})` : '';
        userParts.push(`   - ${reference.srcTerm} => ${reference.tgtTerm}${noteSuffix}`);
      }
    }
  });

  if (params.previousGroup) {
    userParts.push(
      '',
      'Previous Dialogue Group (for consistency):',
      `speaker: ${params.previousGroup.speaker}`,
      'source:',
      params.previousGroup.sourceText,
      'target:',
      params.previousGroup.targetText,
    );
  }

  if (params.validationFeedback) {
    userParts.push('', 'Validation feedback from previous attempt:', params.validationFeedback);
  }

  return userParts.join('\n');
}

export function normalizeProjectType(projectType?: ProjectType): ProjectType {
  if (projectType === 'review') {
    return 'review';
  }
  if (projectType === 'custom') {
    return 'custom';
  }
  return 'translation';
}

export function buildAISystemPrompt(
  projectType: ProjectType,
  params: SystemPromptBuildParams,
): string {
  const normalizedType = normalizeProjectType(projectType);

  if (normalizedType === 'review') {
    return buildReviewSystemPrompt(params);
  }
  if (normalizedType === 'custom') {
    return buildCustomSystemPrompt(params);
  }
  return buildTranslationSystemPrompt(params);
}

export function buildAIUserPrompt(projectType: ProjectType, params: UserPromptBuildParams): string {
  const normalizedType = normalizeProjectType(projectType);

  if (normalizedType === 'review') {
    return buildReviewUserPrompt(params);
  }
  if (normalizedType === 'custom') {
    return buildCustomUserPrompt(params);
  }
  return buildTranslationUserPrompt(params);
}

export function buildAIDialogueUserPrompt(params: DialogueUserPromptBuildParams): string {
  return buildDialogueTranslationUserPrompt(params);
}
