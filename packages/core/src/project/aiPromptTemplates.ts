import type {
  DialoguePromptBundleBuildParams,
  DialogueUserPromptBuildParams,
  PromptTMReference,
  SystemPromptBuildParams,
  TextPromptBundleBuildParams,
  UserPromptBuildParams,
} from "./aiPromptTypes";
import { AI_PROMPT_TEMPLATE_CATALOG } from "./aiPromptTemplateCatalog.generated";

type ProjectType = "translation" | "review" | "custom";

type TemplateValue = string | number;

const TRANSLATION_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.translation;
const REVIEW_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.review;
const CUSTOM_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.custom;
const DIALOGUE_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.dialogue;

function renderTemplate(
  template: string,
  values: Record<string, TemplateValue>,
): string {
  return template.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`[aiPromptTemplates] Missing template value "${key}".`);
    }
    return String(values[key]);
  });
}

function buildTranslationSourceHeader(
  srcLang: string,
  hasProtectedMarkers: boolean,
): string {
  return renderTemplate(
    hasProtectedMarkers
      ? TRANSLATION_PROMPTS.sourceHeaderProtected
      : TRANSLATION_PROMPTS.sourceHeaderPlain,
    { srcLang },
  );
}

function buildReviewLanguageInstruction(
  srcLang: string,
  tgtLang: string,
): string {
  return renderTemplate(REVIEW_PROMPTS.languageInstruction, {
    srcLang,
    tgtLang,
  });
}

function buildReviewSourceHeader(
  srcLang: string,
  hasProtectedMarkers: boolean,
): string {
  return renderTemplate(
    hasProtectedMarkers
      ? REVIEW_PROMPTS.sourceHeaderProtected
      : REVIEW_PROMPTS.sourceHeaderPlain,
    { srcLang },
  );
}

function buildCustomSourceHeader(hasProtectedMarkers: boolean): string {
  return hasProtectedMarkers
    ? CUSTOM_PROMPTS.inputHeaderProtected
    : CUSTOM_PROMPTS.inputHeaderPlain;
}

function buildTranslationSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  const base = renderTemplate(TRANSLATION_PROMPTS.systemBaseRules, {
    srcLang: params.srcLang,
    tgtLang: params.tgtLang,
  });

  if (!trimmedProjectPrompt) {
    return `You are a professional translator.\n\n${base}`;
  }

  return `${trimmedProjectPrompt}\n\n${base}`;
}

function buildTranslationUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [
    buildTranslationSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ];

  const contextText =
    typeof params.context === "string" ? params.context.trim() : "";
  if (contextText) {
    userParts.push(
      "",
      renderTemplate(TRANSLATION_PROMPTS.contextLine, { context: contextText }),
    );
  }

  const currentTranslationText =
    typeof params.currentTranslationPayload === "string"
      ? params.currentTranslationPayload.trim()
      : "";
  const refinementInstructionText =
    typeof params.refinementInstruction === "string"
      ? params.refinementInstruction.trim()
      : "";
  if (currentTranslationText && refinementInstructionText) {
    userParts.push(
      "",
      TRANSLATION_PROMPTS.currentTranslationLabel,
      currentTranslationText,
      "",
      TRANSLATION_PROMPTS.refinementInstructionLabel,
      refinementInstructionText,
    );
  }

  const tmReferences = normalizeTMReferences(
    params.tmReferences,
    params.tmReference,
  );
  if (tmReferences.length > 0) {
    userParts.push("", TRANSLATION_PROMPTS.tmHeader);
    for (const reference of tmReferences) {
      userParts.push(
        renderTemplate(TRANSLATION_PROMPTS.tmEntrySummary, {
          similarity: reference.similarity,
          tmName: reference.tmName,
        }),
        renderTemplate(TRANSLATION_PROMPTS.tmEntrySource, {
          sourceText: reference.sourceText,
        }),
        renderTemplate(TRANSLATION_PROMPTS.tmEntryTarget, {
          targetText: reference.targetText,
        }),
      );
    }
  }

  if (params.tbReferences && params.tbReferences.length > 0) {
    userParts.push("", TRANSLATION_PROMPTS.tbHeader);
    for (const reference of params.tbReferences) {
      const note =
        typeof reference.note === "string" ? reference.note.trim() : "";
      const noteSuffix = note ? ` (note: ${note})` : "";
      userParts.push(
        renderTemplate(TRANSLATION_PROMPTS.tbEntry, {
          srcTerm: reference.srcTerm,
          tgtTerm: reference.tgtTerm,
          noteSuffix,
        }),
      );
    }
  }

  if (params.validationFeedback) {
    userParts.push(
      "",
      TRANSLATION_PROMPTS.validationFeedbackHeader,
      params.validationFeedback,
    );
  }

  return userParts.join("\n");
}

function buildReviewSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  const languageInstruction = buildReviewLanguageInstruction(
    params.srcLang,
    params.tgtLang,
  );

  if (trimmedProjectPrompt) {
    return `${languageInstruction}\n${trimmedProjectPrompt}`;
  }

  return renderTemplate(REVIEW_PROMPTS.defaultSystemBody, {
    srcLang: params.srcLang,
    tgtLang: params.tgtLang,
  });
}

function buildReviewUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [
    buildReviewSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ];

  const contextText =
    typeof params.context === "string" ? params.context.trim() : "";
  userParts.push(
    "",
    renderTemplate(REVIEW_PROMPTS.contextLine, { context: contextText }),
  );

  if (params.validationFeedback) {
    userParts.push(
      "",
      REVIEW_PROMPTS.validationFeedbackHeader,
      params.validationFeedback,
    );
  }

  return userParts.join("\n");
}

function buildCustomSystemPrompt(params: SystemPromptBuildParams): string {
  const trimmedProjectPrompt = params.projectPrompt?.trim();
  if (trimmedProjectPrompt) {
    return trimmedProjectPrompt;
  }

  return CUSTOM_PROMPTS.defaultSystemBody;
}

function buildCustomUserPrompt(params: UserPromptBuildParams): string {
  const userParts = [
    buildCustomSourceHeader(params.hasProtectedMarkers),
    params.sourcePayload,
  ];

  const contextText =
    typeof params.context === "string" ? params.context.trim() : "";
  if (contextText) {
    userParts.push(
      "",
      renderTemplate(CUSTOM_PROMPTS.contextLine, { context: contextText }),
    );
  }

  if (params.validationFeedback) {
    userParts.push(
      "",
      CUSTOM_PROMPTS.validationFeedbackHeader,
      params.validationFeedback,
    );
  }

  return userParts.join("\n");
}

function buildDialogueTranslationUserPrompt(
  params: DialogueUserPromptBuildParams,
): string {
  const userParts: string[] = [
    renderTemplate(DIALOGUE_PROMPTS.introLine, {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
    }),
    DIALOGUE_PROMPTS.jsonContractIntro,
    DIALOGUE_PROMPTS.jsonContractSchema,
    DIALOGUE_PROMPTS.preserveIdLine,
    DIALOGUE_PROMPTS.noOmitIdsLine,
    "",
    DIALOGUE_PROMPTS.segmentsHeader,
  ];

  params.segments.forEach((segment, index) => {
    userParts.push(
      renderTemplate(DIALOGUE_PROMPTS.segmentIndexLine, {
        index: index + 1,
        id: segment.id,
      }),
      renderTemplate(DIALOGUE_PROMPTS.segmentSpeakerLine, {
        speaker: segment.speaker,
      }),
      DIALOGUE_PROMPTS.segmentSourceLabel,
      segment.sourcePayload,
    );

    const tmReferences = normalizeTMReferences(
      segment.tmReferences,
      segment.tmReference,
    );
    if (tmReferences.length > 0) {
      userParts.push(DIALOGUE_PROMPTS.tmHeader);
      for (const reference of tmReferences) {
        userParts.push(
          renderTemplate(DIALOGUE_PROMPTS.tmEntrySummary, {
            similarity: reference.similarity,
            tmName: reference.tmName,
          }),
          renderTemplate(DIALOGUE_PROMPTS.tmEntrySource, {
            sourceText: reference.sourceText,
          }),
          renderTemplate(DIALOGUE_PROMPTS.tmEntryTarget, {
            targetText: reference.targetText,
          }),
        );
      }
    }

    if (segment.tbReferences && segment.tbReferences.length > 0) {
      userParts.push(DIALOGUE_PROMPTS.tbHeader);
      for (const reference of segment.tbReferences) {
        const note =
          typeof reference.note === "string" ? reference.note.trim() : "";
        const noteSuffix = note ? ` (note: ${note})` : "";
        userParts.push(
          renderTemplate(DIALOGUE_PROMPTS.tbEntry, {
            srcTerm: reference.srcTerm,
            tgtTerm: reference.tgtTerm,
            noteSuffix,
          }),
        );
      }
    }
  });

  if (params.previousGroup) {
    userParts.push(
      "",
      DIALOGUE_PROMPTS.previousGroupHeader,
      renderTemplate(DIALOGUE_PROMPTS.previousGroupSpeakerLine, {
        speaker: params.previousGroup.speaker,
      }),
      DIALOGUE_PROMPTS.previousGroupSourceLabel,
      params.previousGroup.sourceText,
      DIALOGUE_PROMPTS.previousGroupTargetLabel,
      params.previousGroup.targetText,
    );
  }

  if (params.validationFeedback) {
    userParts.push(
      "",
      DIALOGUE_PROMPTS.validationFeedbackHeader,
      params.validationFeedback,
    );
  }

  return userParts.join("\n");
}

function resolveTextSourcePayload(
  params: Pick<
    TextPromptBundleBuildParams,
    "sourceText" | "sourceTagPreservedText"
  >,
): {
  hasProtectedMarkers: boolean;
  sourcePayload: string;
} {
  const hasProtectedMarkers =
    typeof params.sourceTagPreservedText === "string" &&
    params.sourceTagPreservedText.length > 0 &&
    params.sourceTagPreservedText !== params.sourceText;

  return {
    hasProtectedMarkers,
    sourcePayload: hasProtectedMarkers
      ? (params.sourceTagPreservedText ?? params.sourceText)
      : params.sourceText,
  };
}

export function normalizeProjectType(projectType?: ProjectType): ProjectType {
  if (projectType === "review") {
    return "review";
  }
  if (projectType === "custom") {
    return "custom";
  }
  return "translation";
}

export function buildAISystemPrompt(
  projectType: ProjectType,
  params: SystemPromptBuildParams,
): string {
  const normalizedType = normalizeProjectType(projectType);

  if (normalizedType === "review") {
    return buildReviewSystemPrompt(params);
  }
  if (normalizedType === "custom") {
    return buildCustomSystemPrompt(params);
  }
  return buildTranslationSystemPrompt(params);
}

export function buildAIUserPrompt(
  projectType: ProjectType,
  params: UserPromptBuildParams,
): string {
  const normalizedType = normalizeProjectType(projectType);

  if (normalizedType === "review") {
    return buildReviewUserPrompt(params);
  }
  if (normalizedType === "custom") {
    return buildCustomUserPrompt(params);
  }
  return buildTranslationUserPrompt(params);
}

export function buildAIDialogueUserPrompt(
  params: DialogueUserPromptBuildParams,
): string {
  return buildDialogueTranslationUserPrompt(params);
}

export function buildAITextPromptBundle(
  projectType: ProjectType,
  params: TextPromptBundleBuildParams,
): {
  systemPrompt: string;
  userPrompt: string;
  hasProtectedMarkers: boolean;
  sourcePayload: string;
} {
  const normalizedType = normalizeProjectType(projectType);
  const { hasProtectedMarkers, sourcePayload } =
    resolveTextSourcePayload(params);

  return {
    systemPrompt: buildAISystemPrompt(normalizedType, {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
    }),
    userPrompt: buildAIUserPrompt(normalizedType, {
      srcLang: params.srcLang,
      sourcePayload,
      hasProtectedMarkers,
      context: params.context,
      currentTranslationPayload: params.currentTranslationPayload,
      refinementInstruction: params.refinementInstruction,
      validationFeedback: params.validationFeedback,
      tmReference: params.tmReference,
      tmReferences: params.tmReferences,
      tbReferences: params.tbReferences,
    }),
    hasProtectedMarkers,
    sourcePayload,
  };
}

function normalizeTMReferences(
  tmReferences?: PromptTMReference[],
  tmReference?: PromptTMReference,
): PromptTMReference[] {
  if (tmReferences && tmReferences.length > 0) return tmReferences;
  return tmReference ? [tmReference] : [];
}

export function buildAIDialoguePromptBundle(
  params: DialoguePromptBundleBuildParams,
): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: buildAISystemPrompt("translation", {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
    }),
    userPrompt: buildAIDialogueUserPrompt({
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      segments: params.segments,
      previousGroup: params.previousGroup,
      validationFeedback: params.validationFeedback,
    }),
  };
}
