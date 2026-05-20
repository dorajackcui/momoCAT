import { buildAISystemPrompt } from "./aiPromptTemplates";
import type {
  WindowModeCurrentSegment,
  WindowModeParsedTranslation,
  WindowModePromptBundle,
  WindowModePromptBundleBuildParams,
  WindowModePromptSections,
} from "./windowModePromptTypes";

function joinBlocks(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n");
}

function trimOptional(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildSystemPrompt(params: WindowModePromptBundleBuildParams): string {
  return [
    buildAISystemPrompt("translation", {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
    }),
    [
      "Window Mode batch rules:",
      "- Return strict JSON only. Do not include Markdown, code fences, prose, comments, or trailing text.",
      "- Translate every current segment exactly once and preserve each id exactly as provided.",
      "- Preserve all markers, tags, placeholders, variables, and protected spans exactly unless they are natural-language text inside the protected payload.",
      "- Use per-segment context, translation memory, concordance, and terminology references only for that segment.",
    ].join("\n"),
  ].join("\n\n");
}

function buildBatchBlock(params: WindowModePromptBundleBuildParams): string {
  return [
    `Batch: translate ${params.currentSegments.length} current segment(s) from ${params.srcLang} to ${params.tgtLang}.`,
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
): string {
  return [
    "Current segments to translate",
    ...segments.map((segment, index) =>
      [`Segment ${index + 1}`, buildCurrentSegmentBlock(segment)].join("\n"),
    ),
  ].join("\n\n");
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

function buildValidationFeedbackBlock(validationFeedback?: string): string {
  const feedback = trimOptional(validationFeedback);
  return feedback ? `Validation feedback\n${feedback}` : "";
}

function buildJsonFormatBlock(): string {
  return [
    "Strict JSON format",
    'Return exactly: {"translations":[{"id":"<id>","text":"<translation>"}]}',
    "The top-level object must contain only translations.",
    "translations must include exactly one object for each current id.",
  ].join("\n");
}

export function buildAIWindowModePromptBundle(
  params: WindowModePromptBundleBuildParams,
): WindowModePromptBundle {
  if (params.currentSegments.length === 0) {
    throw new Error("Window Mode prompt requires at least one current segment.");
  }

  const sections: WindowModePromptSections = {
    batchBlock: buildBatchBlock(params),
    currentSegmentsBlock: buildCurrentSegmentsBlock(params.currentSegments),
    previousContextBlock: buildPreviousContextBlock(params.previousContext),
    nextContextBlock: buildNextContextBlock(params.nextContext),
    validationFeedbackBlock: buildValidationFeedbackBlock(
      params.validationFeedback,
    ),
    jsonFormatBlock: buildJsonFormatBlock(),
  };

  return {
    systemPrompt: buildSystemPrompt(params),
    userPrompt: joinBlocks([
      sections.batchBlock,
      sections.currentSegmentsBlock,
      sections.previousContextBlock,
      sections.nextContextBlock,
      sections.validationFeedbackBlock,
      sections.jsonFormatBlock,
    ]),
    sections,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAIWindowModeResponse(
  content: string,
  expectedIds: string[],
): WindowModeParsedTranslation[] {
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

  const expectedIdSet = new Set(expectedIds);
  const translationsById = new Map<string, WindowModeParsedTranslation>();

  for (const entry of parsed.translations) {
    if (!isJsonObject(entry) || typeof entry.id !== "string" || !entry.id) {
      throw new Error("Missing translation id.");
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

  for (const expectedId of expectedIds) {
    if (!translationsById.has(expectedId)) {
      throw new Error(`Missing translation id "${expectedId}".`);
    }
  }

  return expectedIds.map((id) => translationsById.get(id)!);
}
