import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const promptsDir = path.join(repoRoot, "packages/core/src/project/prompts");

function removeSection(markdown: string, sectionId: string): string {
  const sectionPattern = new RegExp(
    `\\n## ${sectionId}\\n[\\s\\S]*?(?=\\n## [a-z0-9-]+\\n|$)`,
    "g",
  );
  return markdown.replace(sectionPattern, "");
}

async function loadGeneratorModule() {
  return import("../../../../scripts/ai-prompt-template-generator.mjs");
}

describe("AI prompt template catalog generator", () => {
  it("rejects duplicate section ids inside a markdown source", async () => {
    const { buildPromptTemplateCatalog, readPromptMarkdownSources } =
      await loadGeneratorModule();
    const markdownSources = readPromptMarkdownSources(promptsDir);

    markdownSources.translation +=
      "\n\n## system-base-rules\n\n```text\nDuplicate translation rules\n```";

    expect(() => buildPromptTemplateCatalog(markdownSources)).toThrow(
      'Duplicate section "system-base-rules"',
    );
  });

  it("rejects missing required sections", async () => {
    const { buildPromptTemplateCatalog, readPromptMarkdownSources } =
      await loadGeneratorModule();
    const markdownSources = readPromptMarkdownSources(promptsDir);

    markdownSources.custom = removeSection(
      markdownSources.custom,
      "input-header-plain",
    );

    expect(() => buildPromptTemplateCatalog(markdownSources)).toThrow(
      'Missing required section "input-header-plain"',
    );
  });

  it("preserves placeholder templates from markdown into the generated source", async () => {
    const {
      buildPromptTemplateCatalog,
      readPromptMarkdownSources,
      renderGeneratedCatalogSource,
    } = await loadGeneratorModule();
    const catalog = buildPromptTemplateCatalog(
      readPromptMarkdownSources(promptsDir),
    );
    const generatedSource = renderGeneratedCatalogSource(catalog);

    expect(catalog.translation.systemBaseRules).toContain("{{srcLang}}");
    expect(catalog.dialogue.segmentIndexLine).toContain("{{id}}");
    expect(catalog.dialogue.jsonContractSchema).toBe(
      '{"translations":[{"id":"<segment-id>","text":"<translated-text>"}]}',
    );
    expect(generatedSource).toContain("Context: {{context}}");
    expect(generatedSource).toContain('"jsonContractSchema":');
  });

  it("keeps the generated catalog in sync with markdown sources", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/generate-ai-prompt-templates.mjs", "--check"],
        {
          cwd: repoRoot,
          stdio: "pipe",
        },
      ),
    ).not.toThrow();
  });
});
