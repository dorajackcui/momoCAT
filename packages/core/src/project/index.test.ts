import { describe, expect, it } from "vitest";
import {
  BUILTIN_OPENAI_PROVIDER_MODELS,
  DEFAULT_PROJECT_AI_MODEL,
  buildAIDialoguePromptBundle,
  buildAIDialogueUserPrompt,
  buildAISystemPrompt,
  buildAITextPromptBundle,
  buildAIUserPrompt,
  getBuiltinOpenAIProviderModel,
  isBuiltinProjectAIModel,
  isLegacyProjectAIModel,
  PROJECT_AI_MODELS,
  isProjectAIModel,
  normalizeProjectAIModel,
} from "./index";

describe("Project AI Model Registry", () => {
  it("validates normalized project ai provider ids", () => {
    expect(isBuiltinProjectAIModel("builtin:openai:gpt-5-mini")).toBe(true);
    expect(isLegacyProjectAIModel("gpt-5-mini")).toBe(true);
    expect(isProjectAIModel("custom:provider:demo")).toBe(true);
    expect(isProjectAIModel(null)).toBe(false);
  });

  it("normalizes legacy values and preserves custom provider ids", () => {
    expect(normalizeProjectAIModel("gpt-5-mini")).toBe(
      "builtin:openai:gpt-5-mini",
    );
    expect(normalizeProjectAIModel("custom:provider:demo")).toBe(
      "custom:provider:demo",
    );
    expect(normalizeProjectAIModel(undefined)).toBe(DEFAULT_PROJECT_AI_MODEL);
  });

  it("keeps default provider inside supported builtins", () => {
    expect(PROJECT_AI_MODELS.includes(DEFAULT_PROJECT_AI_MODEL)).toBe(true);
  });

  it("maps builtin provider ids back to concrete model names", () => {
    expect(getBuiltinOpenAIProviderModel(DEFAULT_PROJECT_AI_MODEL)).toBe(
      "gpt-5.4-mini",
    );
    expect(
      getBuiltinOpenAIProviderModel("custom:provider:demo"),
    ).toBeUndefined();
    expect(BUILTIN_OPENAI_PROVIDER_MODELS["builtin:openai:gpt-5"]).toBe(
      "gpt-5",
    );
  });
});

describe("Project AI Prompt Templates", () => {
  it("builds default translation system prompt when no custom prompt is provided", () => {
    const prompt = buildAISystemPrompt("translation", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "",
    });

    expect(prompt).toContain("You are a professional translator.");
    expect(prompt).toContain("From en to zh. Output in zh ONLY.");
    expect(prompt).toContain(
      "Keep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}",
    );
    expect(prompt).toContain(
      "Preserve all escape sequences exactly as they appear, including \\n and \\r.",
    );
  });

  it("builds default review system prompt when no custom prompt is provided", () => {
    const prompt = buildAISystemPrompt("review", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "",
    });

    expect(prompt).toContain("You are a professional reviewer.");
    expect(prompt).toContain(
      "Review and improve the provided zh text, using en as source language.",
    );
  });

  it("builds default custom system prompt when no custom prompt is provided", () => {
    const prompt = buildAISystemPrompt("custom", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "",
    });

    expect(prompt).toContain("You are a precise text processing assistant.");
    expect(prompt).toContain("Follow the user-provided instruction exactly.");
  });

  it("keeps translation and review prompt extension semantics, and custom override semantics", () => {
    const translationPrompt = buildAISystemPrompt("translation", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "Use concise style.",
    });
    const reviewPrompt = buildAISystemPrompt("review", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "Fix terminology only.",
    });
    const customPrompt = buildAISystemPrompt("custom", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "Classify sentiment as positive/negative.",
    });

    expect(translationPrompt).toContain("Use concise style.");
    expect(translationPrompt).toContain("From en to zh. Output in zh ONLY.");
    expect(reviewPrompt).toContain(
      "Original text language: en. Translation text language: zh.",
    );
    expect(reviewPrompt).toContain("Fix terminology only.");
    expect(customPrompt).toBe("Classify sentiment as positive/negative.");
  });

  it("builds translation user prompt with context and references", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      context: "UI label",
      tmReference: {
        similarity: 98,
        tmName: "Main TM",
        sourceText: "Hello world",
        targetText: "Hello world target",
      },
      tbReferences: [
        { srcTerm: "world", tgtTerm: "world target", note: "prefer noun form" },
      ],
    });

    expect(prompt).toContain("Source (en):");
    expect(prompt).toContain("Context: UI label");
    expect(prompt).toContain("TM References (top matches):");
    expect(prompt).toContain("- Similarity: 98% | TM: Main TM");
    expect(prompt).toContain("- Source: Hello world");
    expect(prompt).toContain("- Target: Hello world target");
    expect(prompt).toContain("Terminology References (hit terms):");
    expect(prompt).toContain(
      "- world => world target (note: prefer noun form)",
    );
  });

  it("builds translation user prompt with top TM references", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      tmReferences: [
        {
          similarity: 100,
          tmName: "Main TM",
          sourceText: "Hello world",
          targetText: "你好世界",
        },
        {
          similarity: 92,
          tmName: "Main TM",
          sourceText: "Hello there",
          targetText: "你好呀",
        },
        {
          similarity: 88,
          tmName: "Project TM",
          sourceText: "World hello",
          targetText: "世界你好",
        },
      ],
    });

    expect(prompt).toContain("TM References (top matches):");
    expect(prompt).toContain("- Similarity: 100% | TM: Main TM");
    expect(prompt).toContain("- Target: 你好世界");
    expect(prompt).toContain("- Similarity: 92% | TM: Main TM");
    expect(prompt).toContain("- Target: 你好呀");
    expect(prompt).toContain("- Similarity: 88% | TM: Project TM");
    expect(prompt).toContain("- Target: 世界你好");
  });

  it("renders concordance suggestions separately from TM similarity references", () => {
    const prompt = buildAITextPromptBundle("translation", {
      srcLang: "zh-CN",
      tgtLang: "fr-FR",
      sourceText: "麦浪农场",
      concordanceReferences: [
        {
          tmName: "Main TM",
          matchedSourceText: "麦浪农场",
          sourceText:
            "据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。",
          targetText:
            'On dit que le nom "Ferme des vagues de ble" rend hommage a une oeuvre peinte ici.',
        },
      ],
    });

    expect(prompt.userPrompt).toContain("Concordance Suggestions:");
    expect(prompt.userPrompt).toContain("Match: 麦浪农场 | TM: Main TM");
    expect(prompt.userPrompt).not.toContain("Similarity: 73%");
  });

  it("does not include TM/TB sections when translation references are absent", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      context: "UI label",
    });

    expect(prompt).not.toContain("TM References (top matches):");
    expect(prompt).not.toContain("Terminology References (hit terms):");
  });

  it("omits concordance suggestions when TM and TB references together exceed 15", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "alpha",
      hasProtectedMarkers: false,
      tmReferences: Array.from({ length: 3 }, (_, index) => ({
        similarity: 100 - index,
        tmName: `TM ${index + 1}`,
        sourceText: `source ${index + 1}`,
        targetText: `target ${index + 1}`,
      })),
      tbReferences: Array.from({ length: 13 }, (_, index) => ({
        srcTerm: `term ${index + 1}`,
        tgtTerm: `term target ${index + 1}`,
      })),
      concordanceReferences: [
        {
          tmName: "Main TM",
          matchedSourceText: "alpha",
          sourceText: "alpha beta",
          targetText: "alpha target beta target",
        },
      ],
    });

    expect(prompt).toContain("TM References (top matches):");
    expect(prompt).toContain("Terminology References (hit terms):");
    expect(prompt).not.toContain("Concordance Suggestions:");
    expect(prompt).not.toContain("Match: alpha | TM: Main TM");
  });

  it("keeps concordance suggestions when TM and TB references total 15", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "alpha",
      hasProtectedMarkers: false,
      tmReferences: Array.from({ length: 3 }, (_, index) => ({
        similarity: 100 - index,
        tmName: `TM ${index + 1}`,
        sourceText: `source ${index + 1}`,
        targetText: `target ${index + 1}`,
      })),
      tbReferences: Array.from({ length: 12 }, (_, index) => ({
        srcTerm: `term ${index + 1}`,
        tgtTerm: `term target ${index + 1}`,
      })),
      concordanceReferences: [
        {
          tmName: "Main TM",
          matchedSourceText: "alpha",
          sourceText: "alpha beta",
          targetText: "alpha target beta target",
        },
      ],
    });

    expect(prompt).toContain("Concordance Suggestions:");
    expect(prompt).toContain("Match: alpha | TM: Main TM");
  });

  it("does not include context line for translation user prompt when context is empty", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      context: "   ",
    });

    expect(prompt).toContain("Source (en):");
    expect(prompt).not.toContain("Context:");
  });

  it("builds translation user prompt with refinement instruction and current translation", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      context: "UI label",
      currentTranslationPayload: "Current translation",
      refinementInstruction: "Make tone more concise",
    });

    expect(prompt).toContain("Current Translation:");
    expect(prompt).toContain("Current translation");
    expect(prompt).toContain("Refinement Instruction:");
    expect(prompt).toContain("Make tone more concise");
  });

  it("does not include refinement section when only one refinement field is present", () => {
    const prompt = buildAIUserPrompt("translation", {
      srcLang: "en",
      sourcePayload: "Hello world",
      hasProtectedMarkers: false,
      currentTranslationPayload: "Current translation",
    });

    expect(prompt).not.toContain("Current Translation:");
    expect(prompt).not.toContain("Refinement Instruction:");
  });

  it("builds review user prompt with validation feedback", () => {
    const prompt = buildAIUserPrompt("review", {
      srcLang: "en",
      sourcePayload: "Translated text",
      hasProtectedMarkers: false,
      context: "",
      validationFeedback: "Missing marker {1}",
    });

    expect(prompt).toContain("Source (en):");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("Validation feedback from previous attempt:");
    expect(prompt).toContain("Missing marker {1}");
  });

  it("builds custom user prompt with input header", () => {
    const prompt = buildAIUserPrompt("custom", {
      srcLang: "en",
      sourcePayload: "Process this text",
      hasProtectedMarkers: false,
      context: "context text",
    });

    expect(prompt).toContain("Input:");
    expect(prompt).toContain("Context: context text");
  });

  it("does not include context line for custom user prompt when context is empty", () => {
    const prompt = buildAIUserPrompt("custom", {
      srcLang: "en",
      sourcePayload: "Process this text",
      hasProtectedMarkers: false,
      context: "   ",
    });

    expect(prompt).toContain("Input:");
    expect(prompt).not.toContain("Context:");
  });

  it("builds dialogue translation user prompt with previous group and json contract", () => {
    const prompt = buildAIDialogueUserPrompt({
      srcLang: "en",
      tgtLang: "zh",
      segments: [
        {
          id: "seg-1",
          speaker: "Alice",
          sourcePayload: "Hello there",
        },
        {
          id: "seg-2",
          speaker: "Alice",
          sourcePayload: "How are you?",
        },
      ],
      previousGroup: {
        speaker: "Bob",
        sourceText: "Good morning",
        targetText: "Good morning target",
      },
    });

    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain(
      '{"translations":[{"id":"<segment-id>","text":"<translated-text>"}]}',
    );
    expect(prompt).toContain("id: seg-1");
    expect(prompt).toContain("speaker: Alice");
    expect(prompt).toContain("Previous Dialogue Group (for consistency):");
    expect(prompt).toContain("speaker: Bob");
    expect(prompt).toContain("target:");
    expect(prompt).toContain("Good morning target");
  });

  it("renders dialogue concordance suggestions separately from TM similarity references", () => {
    const prompt = buildAIDialogueUserPrompt({
      srcLang: "zh-CN",
      tgtLang: "fr-FR",
      segments: [
        {
          id: "seg-1",
          speaker: "Narrator",
          sourcePayload: "麦浪农场",
          concordanceReferences: [
            {
              tmName: "Main TM",
              matchedSourceText: "麦浪农场",
              sourceText:
                "据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。",
              targetText:
                'On dit que le nom "Ferme des vagues de ble" rend hommage a une oeuvre peinte ici.',
            },
          ],
        },
      ],
    });

    expect(prompt).toContain("Concordance Suggestions:");
    expect(prompt).toContain("Match: 麦浪农场 | TM: Main TM");
    expect(prompt).not.toContain("Similarity: 73%");
  });

  it("omits dialogue concordance suggestions when prompt TM and TB references together exceed 15", () => {
    const prompt = buildAIDialogueUserPrompt({
      srcLang: "en",
      tgtLang: "zh",
      segments: [
        {
          id: "seg-1",
          speaker: "Narrator",
          sourcePayload: "alpha",
          tmReferences: Array.from({ length: 2 }, (_, index) => ({
            similarity: 100 - index,
            tmName: `TM ${index + 1}`,
            sourceText: `source ${index + 1}`,
            targetText: `target ${index + 1}`,
          })),
          tbReferences: Array.from({ length: 8 }, (_, index) => ({
            srcTerm: `term ${index + 1}`,
            tgtTerm: `term target ${index + 1}`,
          })),
          concordanceReferences: [
            {
              tmName: "Main TM",
              matchedSourceText: "alpha",
              sourceText: "alpha beta",
              targetText: "alpha target beta target",
            },
          ],
        },
        {
          id: "seg-2",
          speaker: "Narrator",
          sourcePayload: "beta",
          tmReference: {
            similarity: 91,
            tmName: "TM 3",
            sourceText: "source 3",
            targetText: "target 3",
          },
          tbReferences: Array.from({ length: 5 }, (_, index) => ({
            srcTerm: `other term ${index + 1}`,
            tgtTerm: `other target ${index + 1}`,
          })),
          concordanceReferences: [
            {
              tmName: "Main TM",
              matchedSourceText: "beta",
              sourceText: "beta gamma",
              targetText: "beta target gamma target",
            },
          ],
        },
      ],
    });

    expect(prompt).toContain("TM References (top matches):");
    expect(prompt).toContain("Terminology References (hit terms):");
    expect(prompt).not.toContain("Concordance Suggestions:");
    expect(prompt).not.toContain("Match: alpha | TM: Main TM");
    expect(prompt).not.toContain("Match: beta | TM: Main TM");
  });

  it("builds text prompt bundles from the same canonical rules as legacy builders", () => {
    const bundle = buildAITextPromptBundle("translation", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "Use concise style.",
      sourceText: "Save\\nFile",
      sourceTagPreservedText: "{1>}Save\\nFile<2}",
      context: "Toolbar label",
      currentTranslationPayload: "Current target text",
      refinementInstruction: "Shorten slightly",
      validationFeedback: "Keep markers unchanged",
      tmReference: {
        similarity: 100,
        tmName: "Main TM",
        sourceText: "Save file",
        targetText: "Current target text",
      },
      tbReferences: [{ srcTerm: "Save", tgtTerm: "Save target term" }],
    });

    expect(bundle.hasProtectedMarkers).toBe(true);
    expect(bundle.sourcePayload).toBe("{1>}Save\\nFile<2}");
    expect(bundle.systemPrompt).toBe(
      buildAISystemPrompt("translation", {
        srcLang: "en",
        tgtLang: "zh",
        projectPrompt: "Use concise style.",
      }),
    );
    expect(bundle.userPrompt).toBe(
      buildAIUserPrompt("translation", {
        srcLang: "en",
        sourcePayload: "{1>}Save\\nFile<2}",
        hasProtectedMarkers: true,
        context: "Toolbar label",
        currentTranslationPayload: "Current target text",
        refinementInstruction: "Shorten slightly",
        validationFeedback: "Keep markers unchanged",
        tmReference: {
          similarity: 100,
          tmName: "Main TM",
          sourceText: "Save file",
          targetText: "Current target text",
        },
        tbReferences: [{ srcTerm: "Save", tgtTerm: "Save target term" }],
      }),
    );
  });

  it("keeps plain source text in text prompt bundles when no protected markers are present", () => {
    const bundle = buildAITextPromptBundle("custom", {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "",
      sourceText: "Process this text",
      sourceTagPreservedText: "Process this text",
      context: "Context text",
    });

    expect(bundle.hasProtectedMarkers).toBe(false);
    expect(bundle.sourcePayload).toBe("Process this text");
    expect(bundle.userPrompt).toContain("Input:");
    expect(bundle.userPrompt).toContain("Process this text");
  });

  it("builds dialogue prompt bundles from the same canonical rules as legacy builders", () => {
    const params = {
      srcLang: "en",
      tgtLang: "zh",
      projectPrompt: "Keep speaker tone stable.",
      segments: [
        {
          id: "seg-1",
          speaker: "Alice",
          sourcePayload: "Hello there",
        },
      ],
      previousGroup: {
        speaker: "Bob",
        sourceText: "Good morning",
        targetText: "Good morning target",
      },
      validationFeedback: "Return strict JSON only.",
    };

    const bundle = buildAIDialoguePromptBundle(params);

    expect(bundle.systemPrompt).toBe(
      buildAISystemPrompt("translation", {
        srcLang: "en",
        tgtLang: "zh",
        projectPrompt: "Keep speaker tone stable.",
      }),
    );
    expect(bundle.userPrompt).toBe(buildAIDialogueUserPrompt(params));
  });
});
