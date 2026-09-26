import type {
  PromptConcordanceReference,
  PromptTMReference,
  SystemPromptBuildParams,
  TextPromptBundle,
  TextPromptBundleBuildParams,
  TextPromptSections,
  UserPromptBuildParams,
} from "./aiPromptTypes";
import { AI_PROMPT_TEMPLATE_CATALOG } from "./aiPromptTemplateCatalog.generated";

type ProjectType = "translation" | "custom";

type TemplateValue = string | number;

const TRANSLATION_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.translation;
const CUSTOM_PROMPTS = AI_PROMPT_TEMPLATE_CATALOG.custom;
const MAX_TM_TB_REFERENCES_WITH_CONCORDANCE = 15;

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

function buildEmptyTextPromptSections(): TextPromptSections {
  return {
    sourceBlock: "",
    contextBlock: "",
    currentTranslationBlock: "",
    tmPromptBlock: "",
    concordancePromptBlock: "",
    tbPromptBlock: "",
    referencePromptBlock: "",
    validationFeedbackBlock: "",
  };
}

function joinBlock(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function joinPromptBlocks(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

function buildCurrentTranslationBlock(params: UserPromptBuildParams): string {
  if (typeof params.currentTranslationPayload !== "string") {
    return "";
  }

  const currentTranslationText = params.currentTranslationPayload.trim();
  const refinementInstructionText =
    typeof params.refinementInstruction === "string"
      ? params.refinementInstruction.trim()
      : "";
  if (!refinementInstructionText) {
    return "";
  }

  const parts = currentTranslationText
    ? [
        TRANSLATION_PROMPTS.currentTranslationLabel,
        currentTranslationText,
        "",
        TRANSLATION_PROMPTS.refinementInstructionLabel,
        refinementInstructionText,
      ]
    : [
        TRANSLATION_PROMPTS.currentTranslationLabel,
        "",
        TRANSLATION_PROMPTS.refinementInstructionLabel,
        refinementInstructionText,
      ];

  return parts.join("\n");
}

function buildTranslationUserPromptParts(params: UserPromptBuildParams): {
  userPrompt: string;
  sections: TextPromptSections;
} {
  const sourceBlock = [
    buildTranslationSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ].join("\n");

  const contextText =
    typeof params.context === "string" ? params.context.trim() : "";
  const contextBlock = contextText
    ? renderTemplate(TRANSLATION_PROMPTS.contextLine, { context: contextText })
    : "";

  const currentTranslationBlock = buildCurrentTranslationBlock(params);

  const tmReferences = normalizeTMReferences(
    params.tmReferences,
    params.tmReference,
  );
  const tbReferences = params.tbReferences ?? [];
  const concordanceReferences = getRenderableConcordanceReferences({
    tmReferenceCount: tmReferences.length,
    tbReferenceCount: tbReferences.length,
    concordanceReferences: params.concordanceReferences,
  });
  const tmPromptParts: string[] = [];
  if (tmReferences.length > 0) {
    tmPromptParts.push(TRANSLATION_PROMPTS.tmHeader);
    for (const reference of tmReferences) {
      tmPromptParts.push(
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
  const tmPromptBlock = joinBlock(tmPromptParts);

  const concordancePromptParts: string[] = [];
  if (concordanceReferences.length > 0) {
    concordancePromptParts.push(TRANSLATION_PROMPTS.concordanceHeader);
    for (const reference of concordanceReferences) {
      concordancePromptParts.push(
        renderTemplate(TRANSLATION_PROMPTS.concordanceEntrySummary, {
          matchedSourceText: reference.matchedSourceText,
          tmName: reference.tmName,
        }),
        renderTemplate(TRANSLATION_PROMPTS.concordanceEntrySource, {
          sourceText: reference.sourceText,
        }),
        renderTemplate(TRANSLATION_PROMPTS.concordanceEntryTarget, {
          targetText: reference.targetText,
        }),
      );
    }
  }
  const concordancePromptBlock = joinBlock(concordancePromptParts);

  const tbPromptParts: string[] = [];
  if (tbReferences.length > 0) {
    tbPromptParts.push(TRANSLATION_PROMPTS.tbHeader);
    for (const reference of tbReferences) {
      const note =
        typeof reference.note === "string" ? reference.note.trim() : "";
      const noteSuffix = note ? ` (note: ${note})` : "";
      tbPromptParts.push(
        renderTemplate(TRANSLATION_PROMPTS.tbEntry, {
          srcTerm: reference.srcTerm,
          tgtTerm: reference.tgtTerm,
          noteSuffix,
        }),
      );
    }
  }
  const tbPromptBlock = joinBlock(tbPromptParts);

  const validationFeedbackBlock = params.validationFeedback
    ? joinBlock([
        TRANSLATION_PROMPTS.validationFeedbackHeader,
        params.validationFeedback,
      ])
    : "";

  const sections = {
    sourceBlock,
    contextBlock,
    currentTranslationBlock,
    tmPromptBlock,
    concordancePromptBlock,
    tbPromptBlock,
    referencePromptBlock: joinPromptBlocks([
      tmPromptBlock,
      concordancePromptBlock,
      tbPromptBlock,
    ]),
    validationFeedbackBlock,
  };

  return {
    userPrompt: joinPromptBlocks([
      sourceBlock,
      contextBlock,
      currentTranslationBlock,
      tmPromptBlock,
      concordancePromptBlock,
      tbPromptBlock,
      validationFeedbackBlock,
    ]),
    sections,
  };
}

function buildTranslationUserPrompt(params: UserPromptBuildParams): string {
  return buildTranslationUserPromptParts(params).userPrompt;
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

  if (normalizedType === "custom") {
    return buildCustomUserPrompt(params);
  }
  return buildTranslationUserPrompt(params);
}

export function buildAITextPromptBundle(
  projectType: ProjectType,
  params: TextPromptBundleBuildParams,
): TextPromptBundle {
  const normalizedType = normalizeProjectType(projectType);
  const { hasProtectedMarkers, sourcePayload } =
    resolveTextSourcePayload(params);
  const userPromptParams = {
    srcLang: params.srcLang,
    sourcePayload,
    hasProtectedMarkers,
    context: params.context,
    currentTranslationPayload: params.currentTranslationPayload,
    refinementInstruction: params.refinementInstruction,
    validationFeedback: params.validationFeedback,
    tmReference: params.tmReference,
    tmReferences: params.tmReferences,
    concordanceReferences: params.concordanceReferences,
    tbReferences: params.tbReferences,
  };
  const userPromptParts =
    normalizedType === "translation"
      ? buildTranslationUserPromptParts(userPromptParams)
      : {
          userPrompt: buildAIUserPrompt(normalizedType, userPromptParams),
          sections: buildEmptyTextPromptSections(),
        };

  return {
    systemPrompt: buildAISystemPrompt(normalizedType, {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
    }),
    userPrompt: userPromptParts.userPrompt,
    hasProtectedMarkers,
    sourcePayload,
    sections: userPromptParts.sections,
  };
}

function normalizeTMReferences(
  tmReferences?: PromptTMReference[],
  tmReference?: PromptTMReference,
): PromptTMReference[] {
  if (tmReferences && tmReferences.length > 0) return tmReferences;
  return tmReference ? [tmReference] : [];
}

function getRenderableConcordanceReferences(params: {
  tmReferenceCount: number;
  tbReferenceCount: number;
  concordanceReferences?: PromptConcordanceReference[];
}): PromptConcordanceReference[] {
  const concordanceReferences = params.concordanceReferences ?? [];
  if (concordanceReferences.length === 0) {
    return [];
  }

  if (
    shouldOmitConcordanceReferences(
      params.tmReferenceCount,
      params.tbReferenceCount,
    )
  ) {
    return [];
  }

  return concordanceReferences;
}

function shouldOmitConcordanceReferences(
  tmReferenceCount: number,
  tbReferenceCount: number,
): boolean {
  return (
    tmReferenceCount > 0 &&
    tbReferenceCount > 0 &&
    tmReferenceCount + tbReferenceCount > MAX_TM_TB_REFERENCES_WITH_CONCORDANCE
  );
}
