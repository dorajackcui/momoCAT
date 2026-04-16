import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPromptTemplateCatalog,
  formatGeneratedCatalogSource,
  readPromptMarkdownSources,
} from "./ai-prompt-template-generator.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const promptsDir = path.join(repoRoot, "packages/core/src/project/prompts");
const outputPath = path.join(
  repoRoot,
  "packages/core/src/project/aiPromptTemplateCatalog.generated.ts",
);
const shouldCheck = process.argv.includes("--check");

const markdownSources = readPromptMarkdownSources(promptsDir);
const catalog = buildPromptTemplateCatalog(markdownSources);
const expectedOutput = await formatGeneratedCatalogSource(catalog);
const currentOutput = fs.existsSync(outputPath)
  ? fs.readFileSync(outputPath, "utf8")
  : null;

if (shouldCheck) {
  if (currentOutput !== expectedOutput) {
    console.error(
      `[ai-prompt-templates] Generated catalog is out of date: ${path.relative(repoRoot, outputPath)}`,
    );
    process.exit(1);
  }

  console.log("[ai-prompt-templates] Generated catalog is up to date.");
  process.exit(0);
}

fs.writeFileSync(outputPath, expectedOutput, "utf8");
console.log(
  `[ai-prompt-templates] Wrote ${path.relative(repoRoot, outputPath)}.`,
);
