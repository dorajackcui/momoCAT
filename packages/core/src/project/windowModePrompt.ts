import { buildAISystemPrompt } from "./aiPromptTemplates";
import type {
  WindowModeCurrentSegment,
  WindowModeParsedTranslation,
  WindowModePromptBundle,
  WindowModePromptBundleBuildParams,
  WindowModePromptSections,
  WindowModeProjectType,
  WindowModeReadOnlyContextRow,
  WindowModeRequestMode,
} from "./windowModePromptTypes";

function joinBlocks(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

function trimOptional(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function getWindowModeProjectType(
  projectType: WindowModePromptBundleBuildParams["projectType"],
): WindowModeProjectType {
  if (projectType === "review" || projectType === "custom") {
    return projectType;
  }
  return "translation";
}

function isTranslationProject(
  params: Pick<WindowModePromptBundleBuildParams, "projectType">,
): boolean {
  return getWindowModeProjectType(params.projectType) === "translation";
}

function getRequestMode(
  requestMode: WindowModePromptBundleBuildParams["requestMode"],
): WindowModeRequestMode {
  return requestMode === "window-partial" ? "window-partial" : "window";
}

function buildTranslationWindowModeSystemPrompt(
  params: WindowModePromptBundleBuildParams,
): string {
  const base = [
    `From ${params.srcLang} to ${params.tgtLang}. Output in ${params.tgtLang} ONLY.`,
    "Keep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}",
    "Preserve all escape sequences exactly as they appear, including \\n and \\r.",
  ].join("\n");
  const projectPrompt = trimOptional(params.projectPrompt);

  return projectPrompt
    ? `${projectPrompt}\n\n${base}`
    : `You are a professional translator.\n\n${base}`;
}

function buildSystemPrompt(params: WindowModePromptBundleBuildParams): string {
  const translationProject = isTranslationProject(params);
  return [
    translationProject
      ? buildTranslationWindowModeSystemPrompt(params)
      : buildAISystemPrompt(getWindowModeProjectType(params.projectType), {
          srcLang: params.srcLang,
          tgtLang: params.tgtLang,
          projectPrompt: params.projectPrompt,
        }),
    [
      "Window Mode batch rules:",
      "- Return strict JSON only. Do not include Markdown, code fences, prose, comments, or trailing text.",
      translationProject
        ? "- Translate every current segment exactly once and preserve each id exactly as provided."
        : "- Process every current segment exactly once and preserve each id exactly as provided.",
      "- Preserve all markers, tags, placeholders, variables, and protected spans exactly unless they are natural-language text inside the protected payload.",
      translationProject
        ? "- Use per-segment context, translation memory, concordance, and terminology references only for that segment."
        : "- Use per-segment context and reference materials only for that segment.",
    ].join("\n"),
  ].join("\n\n");
}

function buildBatchBlock(params: WindowModePromptBundleBuildParams): string {
  if (getRequestMode(params.requestMode) === "window-partial") {
    return [
      `Batch: partial window request from ${params.srcLang} to ${params.tgtLang}.`,
      `Return target text for ids: ${params.currentSegments.map((segment) => segment.id).join(", ")}`,
    ].join("\n");
  }

  const action = isTranslationProject(params) ? "translate" : "process";
  return [
    `Batch: ${action} ${params.currentSegments.length} current segment(s) from ${params.srcLang} to ${params.tgtLang}.`,
    `Current ids: ${params.currentSegments.map((segment) => segment.id).join(", ")}`,
  ].join("\n");
}

function buildCurrentSegmentBlock(segment: WindowModeCurrentSegment): string {
  const parts = [`id: ${segment.id}`, "Source:", segment.sourcePayload];
  const context = trimOptional(segment.context);

  if (context) {
    parts.push("Context:", context);
  }

  if (segment.tmReferences && segment.tmReferences.length > 0) {
    parts.push("TM References");
    segment.tmReferences.forEach((reference, index) => {
      parts.push(
        `${index + 1}. ${reference.similarity}% ${reference.tmName}`,
        `Source: ${reference.sourceText}`,
        `Target: ${reference.targetText}`,
      );
    });
  }

  if (
    segment.concordanceReferences &&
    segment.concordanceReferences.length > 0
  ) {
    parts.push("Concordance Suggestions");
    segment.concordanceReferences.forEach((reference, index) => {
      parts.push(
        `${index + 1}. ${reference.matchedSourceText} (${reference.tmName})`,
        `Source: ${reference.sourceText}`,
        `Target: ${reference.targetText}`,
      );
    });
  }

  if (segment.tbReferences && segment.tbReferences.length > 0) {
    parts.push("Terminology References");
    segment.tbReferences.forEach((reference, index) => {
      const note = trimOptional(reference.note ?? undefined);
      const noteSuffix = note ? ` (note: ${note})` : "";
      parts.push(
        `${index + 1}. ${reference.srcTerm} -> ${reference.tgtTerm}${noteSuffix}`,
      );
    });
  }

  return parts.join("\n");
}

function buildCurrentSegmentsBlock(
  segments: WindowModeCurrentSegment[],
  projectType: WindowModePromptBundleBuildParams["projectType"],
  requestMode: WindowModePromptBundleBuildParams["requestMode"],
): string {
  if (getRequestMode(requestMode) === "window-partial") {
    return [
      "Rows requiring target text. Return exactly these ids.",
      ...segments.map((segment, index) =>
        [`Segment ${index + 1}`, buildCurrentSegmentBlock(segment)].join("\n"),
      ),
    ].join("\n\n");
  }

  const action = isTranslationProject({ projectType }) ? "translate" : "process";
  return [
    `Current segments to ${action}`,
    ...segments.map((segment, index) =>
      [`Segment ${index + 1}`, buildCurrentSegmentBlock(segment)].join("\n"),
    ),
  ].join("\n\n");
}

function buildTMReferenceBlock(segments: WindowModeCurrentSegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment.tmReferences || segment.tmReferences.length === 0) {
      continue;
    }
    parts.push(`id: ${segment.id}`);
    segment.tmReferences.forEach((reference, index) => {
      parts.push(
        `${index + 1}. ${reference.similarity}% ${reference.tmName} | ${reference.sourceText} -> ${reference.targetText}`,
      );
    });
  }

  return parts.length > 0 ? ["TM References", ...parts].join("\n") : "";
}

function buildConcordanceReferenceBlock(
  segments: WindowModeCurrentSegment[],
): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (
      !segment.concordanceReferences ||
      segment.concordanceReferences.length === 0
    ) {
      continue;
    }
    parts.push(`id: ${segment.id}`);
    segment.concordanceReferences.forEach((reference, index) => {
      parts.push(
        `${index + 1}. ${reference.matchedSourceText} (${reference.tmName}) | ${reference.sourceText} -> ${reference.targetText}`,
      );
    });
  }

  return parts.length > 0
    ? ["Concordance Suggestions", ...parts].join("\n")
    : "";
}

function buildTBReferenceBlock(segments: WindowModeCurrentSegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment.tbReferences || segment.tbReferences.length === 0) {
      continue;
    }
    parts.push(`id: ${segment.id}`);
    segment.tbReferences.forEach((reference, index) => {
      const note = trimOptional(reference.note ?? undefined);
      const noteSuffix = note ? ` (note: ${note})` : "";
      parts.push(
        `${index + 1}. ${reference.srcTerm} -> ${reference.tgtTerm}${noteSuffix}`,
      );
    });
  }

  return parts.length > 0
    ? ["Terminology References", ...parts].join("\n")
    : "";
}

function buildPreviousContextBlock(
  rows: WindowModePromptBundleBuildParams["previousContext"],
): string {
  if (!rows || rows.length === 0) {
    return "";
  }

  return [
    "Previous 5 translated rows",
    ...rows.map((row, index) => `${index + 1}. ${row.source} -> ${row.target}`),
  ].join("\n");
}

function buildNextContextBlock(
  rows: WindowModePromptBundleBuildParams["nextContext"],
): string {
  if (!rows || rows.length === 0) {
    return "";
  }

  return [
    "Next 5 source rows",
    ...rows.map((row, index) => `${index + 1}. ${row.source}`),
  ].join("\n");
}

function buildReadOnlyContextRow(row: WindowModeReadOnlyContextRow, index: number): string {
  const rowNumber = typeof row.rowNumber === "number" ? ` row ${row.rowNumber}` : "";
  const parts = [`${index + 1}. ${row.role}${rowNumber}`, "Source:", row.source];
  const target = trimOptional(row.target);
  if (target) {
    parts.push("Target:", target);
  }
  return parts.join("\n");
}

function buildReadOnlyContextBlock(
  rows: WindowModePromptBundleBuildParams["readOnlyContextRows"],
): string {
  if (!rows || rows.length === 0) {
    return "";
  }

  return [
    "Read-only context rows. Do not produce output or return ids for these rows.",
    ...rows.map((row, index) => buildReadOnlyContextRow(row, index)),
  ].join("\n\n");
}

function buildValidationFeedbackBlock(validationFeedback?: string): string {
  const feedback = trimOptional(validationFeedback);
  return feedback ? `Validation feedback\n${feedback}` : "";
}

function buildJsonFormatBlock(
  projectType: WindowModePromptBundleBuildParams["projectType"],
  requestMode: WindowModePromptBundleBuildParams["requestMode"],
): string {
  const textPlaceholder =
    getRequestMode(requestMode) === "window-partial"
      ? "<target text>"
      : isTranslationProject({ projectType })
        ? "<translation>"
        : "<result>";
  return [
    "Strict JSON format",
    `Return exactly: {"translations":[{"id":"<id>","text":"${textPlaceholder}"}]}`,
    "The top-level object must contain only the translations field.",
    "The translations array must include exactly one object for each current id.",
  ].join("\n");
}

function normalizeCurrentSegments(
  segments: WindowModeCurrentSegment[],
): WindowModeCurrentSegment[] {
  if (segments.length === 0) {
    throw new Error("Window Mode prompt requires at least one current segment.");
  }

  const seenIds = new Set<string>();
  return segments.map((segment) => {
    const id = segment.id.trim();
    if (!id) {
      throw new Error("Window Mode current segment id must be non-empty.");
    }
    if (seenIds.has(id)) {
      throw new Error(`Window Mode duplicate current segment id "${id}".`);
    }
    seenIds.add(id);
    return { ...segment, id };
  });
}

export function buildAIWindowModePromptBundle(
  params: WindowModePromptBundleBuildParams,
): WindowModePromptBundle {
  const currentSegments = normalizeCurrentSegments(params.currentSegments);
  const requestMode = getRequestMode(params.requestMode);
  const normalizedParams = { ...params, requestMode, currentSegments };
  const readOnlyContextBlock = buildReadOnlyContextBlock(
    normalizedParams.readOnlyContextRows,
  );

  const sections: WindowModePromptSections = {
    batchBlock: buildBatchBlock(normalizedParams),
    currentSegmentsBlock: buildCurrentSegmentsBlock(
      currentSegments,
      normalizedParams.projectType,
      normalizedParams.requestMode,
    ),
    tmPromptBlock: buildTMReferenceBlock(currentSegments),
    concordancePromptBlock: buildConcordanceReferenceBlock(currentSegments),
    tbPromptBlock: buildTBReferenceBlock(currentSegments),
    referencePromptBlock: "",
    previousContextBlock:
      requestMode === "window"
        ? buildPreviousContextBlock(params.previousContext)
        : readOnlyContextBlock,
    nextContextBlock:
      requestMode === "window" ? buildNextContextBlock(params.nextContext) : "",
    validationFeedbackBlock: buildValidationFeedbackBlock(
      params.validationFeedback,
    ),
    jsonFormatBlock: buildJsonFormatBlock(
      normalizedParams.projectType,
      normalizedParams.requestMode,
    ),
  };
  sections.referencePromptBlock = joinBlocks([
    sections.tmPromptBlock,
    sections.concordancePromptBlock,
    sections.tbPromptBlock,
  ]);

  const userPromptBlocks =
    requestMode === "window-partial"
      ? [
          sections.batchBlock,
          sections.previousContextBlock,
          sections.currentSegmentsBlock,
          sections.validationFeedbackBlock,
          sections.jsonFormatBlock,
        ]
      : [
          sections.batchBlock,
          sections.currentSegmentsBlock,
          sections.previousContextBlock,
          sections.nextContextBlock,
          sections.validationFeedbackBlock,
          sections.jsonFormatBlock,
        ];

  return {
    systemPrompt: buildSystemPrompt(normalizedParams),
    userPrompt: joinBlocks(userPromptBlocks),
    sections,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExpectedIds(expectedIds: string[]): string[] {
  if (expectedIds.length === 0) {
    throw new Error(
      "Window Mode requires at least one expected translation id.",
    );
  }

  const seenIds = new Set<string>();
  return expectedIds.map((expectedId) => {
    const id = expectedId.trim();
    if (!id) {
      throw new Error("Window Mode expected translation id must be non-empty.");
    }
    if (seenIds.has(id)) {
      throw new Error(`Window Mode duplicate expected translation id "${id}".`);
    }
    seenIds.add(id);
    return id;
  });
}

export function parseAIWindowModeResponse(
  content: string,
  expectedIds: string[],
): WindowModeParsedTranslation[] {
  const normalizedExpectedIds = normalizeExpectedIds(expectedIds);
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("AI Window Mode response was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("AI Window Mode response was invalid strict JSON.");
  }

  if (!isJsonObject(parsed)) {
    throw new Error("AI Window Mode response must be a JSON object.");
  }

  const topLevelFields = Object.keys(parsed);
  const unexpectedField = topLevelFields.find(
    (field) => field !== "translations",
  );
  if (unexpectedField) {
    throw new Error(`Unexpected top-level field "${unexpectedField}".`);
  }

  if (!Array.isArray(parsed.translations)) {
    throw new Error("Window Mode translations must be an array.");
  }

  const expectedIdSet = new Set(normalizedExpectedIds);
  const translationsById = new Map<string, WindowModeParsedTranslation>();

  for (const entry of parsed.translations) {
    if (!isJsonObject(entry) || typeof entry.id !== "string" || !entry.id) {
      throw new Error("Missing translation id.");
    }
    const unexpectedEntryField = Object.keys(entry).find(
      (field) => field !== "id" && field !== "text",
    );
    if (unexpectedEntryField) {
      throw new Error(
        `Unexpected translation field "${unexpectedEntryField}" for id "${entry.id}".`,
      );
    }
    if (!expectedIdSet.has(entry.id)) {
      throw new Error(`Unknown translation id "${entry.id}".`);
    }
    if (translationsById.has(entry.id)) {
      throw new Error(`Duplicate translation id "${entry.id}".`);
    }
    if (typeof entry.text !== "string") {
      throw new Error(`Translation text must be a string for id "${entry.id}".`);
    }
    translationsById.set(entry.id, { id: entry.id, text: entry.text });
  }

  for (const expectedId of normalizedExpectedIds) {
    if (!translationsById.has(expectedId)) {
      throw new Error(`Missing translation id "${expectedId}".`);
    }
  }

  return normalizedExpectedIds.map((id) => translationsById.get(id)!);
}
