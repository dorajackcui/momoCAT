import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";

export const PROMPT_TEMPLATE_SPECS = {
  translation: {
    fileName: "translation.md",
    sections: {
      systemBaseRules: "system-base-rules",
      sourceHeaderPlain: "source-header-plain",
      sourceHeaderProtected: "source-header-protected",
      contextLine: "context-line",
      currentTranslationLabel: "current-translation-label",
      refinementInstructionLabel: "refinement-instruction-label",
      tmHeader: "tm-header",
      tmEntrySummary: "tm-entry-summary",
      tmEntrySource: "tm-entry-source",
      tmEntryTarget: "tm-entry-target",
      tbHeader: "tb-header",
      tbEntry: "tb-entry",
      validationFeedbackHeader: "validation-feedback-header",
    },
  },
  review: {
    fileName: "review.md",
    sections: {
      defaultSystemBody: "default-system-body",
      languageInstruction: "language-instruction",
      sourceHeaderPlain: "source-header-plain",
      sourceHeaderProtected: "source-header-protected",
      contextLine: "context-line",
      validationFeedbackHeader: "validation-feedback-header",
    },
  },
  custom: {
    fileName: "custom.md",
    sections: {
      defaultSystemBody: "default-system-body",
      inputHeaderPlain: "input-header-plain",
      inputHeaderProtected: "input-header-protected",
      contextLine: "context-line",
      validationFeedbackHeader: "validation-feedback-header",
    },
  },
  dialogue: {
    fileName: "dialogue.md",
    sections: {
      introLine: "intro-line",
      jsonContractIntro: "json-contract-intro",
      jsonContractSchema: "json-contract-schema",
      preserveIdLine: "preserve-id-line",
      noOmitIdsLine: "no-omit-ids-line",
      segmentsHeader: "segments-header",
      segmentIndexLine: "segment-index-line",
      segmentSpeakerLine: "segment-speaker-line",
      segmentSourceLabel: "segment-source-label",
      tmHeader: "tm-header",
      tmEntrySummary: "tm-entry-summary",
      tmEntrySource: "tm-entry-source",
      tmEntryTarget: "tm-entry-target",
      tbHeader: "tb-header",
      tbEntry: "tb-entry",
      previousGroupHeader: "previous-group-header",
      previousGroupSpeakerLine: "previous-group-speaker-line",
      previousGroupSourceLabel: "previous-group-source-label",
      previousGroupTargetLabel: "previous-group-target-label",
      validationFeedbackHeader: "validation-feedback-header",
    },
  },
};

const SECTION_HEADER_PATTERN = /^## ([a-z0-9-]+)\s*$/gm;
const TEXT_FENCE_PATTERN = /```text\r?\n([\s\S]*?)\r?\n```/g;

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}

function ensureNoExtraneousContent(sectionBody, fileLabel, sectionId) {
  const bodyWithoutTextFences = sectionBody
    .replace(TEXT_FENCE_PATTERN, "")
    .trim();
  if (bodyWithoutTextFences.length > 0) {
    throw new Error(
      `[ai-prompt-templates] Section "${sectionId}" in ${fileLabel} must only contain one text code fence.`,
    );
  }
}

export function parseMarkdownSections(markdown, fileLabel) {
  const normalizedMarkdown = normalizeLineEndings(markdown);
  const matches = [...normalizedMarkdown.matchAll(SECTION_HEADER_PATTERN)];
  const sections = {};

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const sectionId = match[1];
    const sectionStart = match.index + match[0].length;
    const sectionEnd =
      index + 1 < matches.length
        ? matches[index + 1].index
        : normalizedMarkdown.length;
    const sectionBody = normalizedMarkdown
      .slice(sectionStart, sectionEnd)
      .trim();

    if (Object.prototype.hasOwnProperty.call(sections, sectionId)) {
      throw new Error(
        `[ai-prompt-templates] Duplicate section "${sectionId}" found in ${fileLabel}.`,
      );
    }

    const textBlocks = [...sectionBody.matchAll(TEXT_FENCE_PATTERN)];
    if (textBlocks.length !== 1) {
      throw new Error(
        `[ai-prompt-templates] Section "${sectionId}" in ${fileLabel} must contain exactly one text code fence.`,
      );
    }

    ensureNoExtraneousContent(sectionBody, fileLabel, sectionId);
    sections[sectionId] = normalizeLineEndings(textBlocks[0][1]);
  }

  return sections;
}

export function buildPromptTemplateCatalog(markdownSources) {
  const catalog = {};

  for (const [templateName, spec] of Object.entries(PROMPT_TEMPLATE_SPECS)) {
    const markdown = markdownSources[templateName];
    if (typeof markdown !== "string") {
      throw new Error(
        `[ai-prompt-templates] Missing markdown source for template "${templateName}".`,
      );
    }

    const parsedSections = parseMarkdownSections(markdown, spec.fileName);
    const templateCatalog = {};

    for (const [logicalName, sectionId] of Object.entries(spec.sections)) {
      const sectionValue = parsedSections[sectionId];
      if (typeof sectionValue !== "string") {
        throw new Error(
          `[ai-prompt-templates] Missing required section "${sectionId}" in ${spec.fileName}.`,
        );
      }
      templateCatalog[logicalName] = sectionValue;
    }

    catalog[templateName] = templateCatalog;
  }

  return catalog;
}

export function readPromptMarkdownSources(promptsDir) {
  const sources = {};

  for (const [templateName, spec] of Object.entries(PROMPT_TEMPLATE_SPECS)) {
    const filePath = path.join(promptsDir, spec.fileName);
    sources[templateName] = fs.readFileSync(filePath, "utf8");
  }

  return sources;
}

export function renderGeneratedCatalogSource(catalog) {
  return [
    "// This file is generated by scripts/generate-ai-prompt-templates.mjs.",
    "// Do not edit manually; update the Markdown sources in packages/core/src/project/prompts/.",
    "",
    `export const AI_PROMPT_TEMPLATE_CATALOG = ${JSON.stringify(catalog, null, 2)} as const;`,
    "",
    "export type AIPromptTemplateCatalog = typeof AI_PROMPT_TEMPLATE_CATALOG;",
    "",
  ].join("\n");
}

export async function formatGeneratedCatalogSource(catalog) {
  return prettier.format(renderGeneratedCatalogSource(catalog), {
    parser: "typescript",
  });
}
