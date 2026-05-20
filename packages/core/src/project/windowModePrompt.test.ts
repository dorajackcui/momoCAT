import { describe, expect, it } from "vitest";
import {
  buildAIWindowModePromptBundle,
  parseAIWindowModeResponse,
} from "./index";

describe("Window Mode prompt builder", () => {
  it("builds a compact batch prompt with per-segment references and id-free context rows", () => {
    const bundle = buildAIWindowModePromptBundle({
      srcLang: "en",
      tgtLang: "fr",
      projectPrompt: "Use concise UI language.",
      currentSegments: [
        {
          id: "row-2",
          sourcePayload: "{1>}Save file<2}",
          context: "Toolbar label",
          tmReferences: [
            {
              similarity: 100,
              tmName: "Main TM",
              sourceText: "Save file",
              targetText: "Enregistrer le fichier",
            },
          ],
          concordanceReferences: [
            {
              tmName: "Main TM",
              matchedSourceText: "file",
              sourceText: "Open file",
              targetText: "Ouvrir le fichier",
            },
          ],
          tbReferences: [
            {
              srcTerm: "Save",
              tgtTerm: "Enregistrer",
              note: "Use the UI verb.",
            },
          ],
        },
        {
          id: "row-3",
          sourcePayload: "Close",
          context: "Button",
        },
      ],
      previousContext: [{ source: "Open", target: "Ouvrir" }],
      nextContext: [{ source: "Preferences" }],
    });

    expect(bundle.systemPrompt).toContain("Use concise UI language.");
    expect(bundle.systemPrompt).toContain("Return strict JSON only");
    expect(bundle.userPrompt).toContain("Current segments to translate");
    expect(bundle.userPrompt).toContain("id: row-2");
    expect(bundle.userPrompt).toContain("{1>}Save file<2}");
    expect(bundle.userPrompt).toContain("TM References");
    expect(bundle.userPrompt).toContain("Concordance Suggestions");
    expect(bundle.userPrompt).toContain("Terminology References");
    expect(bundle.userPrompt).toContain("Context:");
    expect(bundle.userPrompt).toContain("Previous 5 translated rows");
    expect(bundle.userPrompt).toContain("1. Open -> Ouvrir");
    expect(bundle.userPrompt).toContain("Next 5 source rows");
    expect(bundle.userPrompt).toContain("1. Preferences");
    expect(bundle.userPrompt).not.toContain("documentId");
    expect(bundle.userPrompt).not.toContain("unitId");
    expect(bundle.sections.previousContextBlock).toBe(
      "Previous 5 translated rows\n1. Open -> Ouvrir",
    );
    expect(bundle.sections.nextContextBlock).toBe(
      "Next 5 source rows\n1. Preferences",
    );
  });

  it.each([
    [[], /requires at least one current segment/i],
    [
      [{ id: " ", sourcePayload: "Save" }],
      /current segment id must be non-empty/i,
    ],
    [
      [
        { id: "row-2", sourcePayload: "Save" },
        { id: "row-2", sourcePayload: "Close" },
      ],
      /duplicate current segment id/i,
    ],
  ])("rejects invalid current segment ids %#", (currentSegments, message) => {
    expect(() =>
      buildAIWindowModePromptBundle({
        srcLang: "en",
        tgtLang: "fr",
        currentSegments,
      }),
    ).toThrow(message);
  });

  it("renders validation feedback when present", () => {
    const bundle = buildAIWindowModePromptBundle({
      srcLang: "en",
      tgtLang: "fr",
      currentSegments: [{ id: "row-2", sourcePayload: "Save" }],
      validationFeedback: "The previous attempt omitted a marker.",
    });

    expect(bundle.userPrompt).toContain("Validation feedback");
    expect(bundle.userPrompt).toContain(
      "The previous attempt omitted a marker.",
    );
    expect(bundle.sections.validationFeedbackBlock).toBe(
      "Validation feedback\nThe previous attempt omitted a marker.",
    );
  });

  it("uses custom project system prompt semantics for Window Mode", () => {
    const bundle = buildAIWindowModePromptBundle({
      projectType: "custom",
      srcLang: "en",
      tgtLang: "fr",
      projectPrompt: "Classify sentiment.",
      currentSegments: [{ id: "row-2", sourcePayload: "Great work" }],
    });

    expect(bundle.systemPrompt).toContain("Classify sentiment.");
    expect(bundle.systemPrompt).toContain("Return strict JSON only");
    expect(bundle.systemPrompt).not.toContain(
      "You are a professional translator.",
    );
    expect(bundle.systemPrompt).not.toContain("From en to fr. Output in fr");
  });

  it("exposes aggregate reference-only sections separately from current source text", () => {
    const bundle = buildAIWindowModePromptBundle({
      srcLang: "en",
      tgtLang: "fr",
      currentSegments: [
        {
          id: "row-2",
          sourcePayload: "Save file",
          context: "Toolbar label",
          tmReferences: [
            {
              similarity: 100,
              tmName: "Main TM",
              sourceText: "Save file",
              targetText: "Enregistrer le fichier",
            },
          ],
          tbReferences: [
            {
              srcTerm: "Save",
              tgtTerm: "Enregistrer",
              note: "Use the UI verb.",
            },
          ],
        },
      ],
    });

    expect(bundle.sections.tmPromptBlock).toContain("Main TM");
    expect(bundle.sections.tmPromptBlock).toContain("Enregistrer le fichier");
    expect(bundle.sections.tmPromptBlock).not.toContain("Source:");
    expect(bundle.sections.tbPromptBlock).toContain("Save -> Enregistrer");
    expect(bundle.sections.tbPromptBlock).not.toContain("Source:");
    expect(bundle.sections.referencePromptBlock).toContain(
      bundle.sections.tmPromptBlock,
    );
    expect(bundle.sections.referencePromptBlock).toContain(
      bundle.sections.tbPromptBlock,
    );
  });
});

describe("Window Mode strict JSON parser", () => {
  it("returns translations in expected id order", () => {
    expect(
      parseAIWindowModeResponse(
        JSON.stringify({
          translations: [
            { id: "row-3", text: "Fermer" },
            { id: "row-2", text: "Enregistrer le fichier" },
          ],
        }),
        ["row-2", "row-3"],
      ),
    ).toEqual([
      { id: "row-2", text: "Enregistrer le fichier" },
      { id: "row-3", text: "Fermer" },
    ]);
  });

  it.each([
    ["", /response was empty/i],
    ["```json\n{\"translations\":[]}\n```", /invalid strict JSON/i],
    ["{}", /translations must be an array/i],
    [
      JSON.stringify({
        translations: [{ id: "row-2", text: "A" }],
        extra: true,
      }),
      /unexpected top-level field/i,
    ],
    [
      JSON.stringify({
        translations: [{ id: "row-2", text: "A", note: "extra" }],
      }),
      /unexpected translation field/i,
    ],
    [
      JSON.stringify({ translations: [{ id: "row-9", text: "A" }] }),
      /unknown translation id/i,
    ],
    [
      JSON.stringify({
        translations: [
          { id: "row-2", text: "A" },
          { id: "row-2", text: "B" },
        ],
      }),
      /duplicate translation id/i,
    ],
    [
      JSON.stringify({ translations: [{ id: "row-2" }] }),
      /translation text must be a string/i,
    ],
    [
      JSON.stringify({ translations: [{ id: "row-2", text: "A" }] }),
      /missing translation id/i,
    ],
  ])("rejects invalid response %#", (content, message) => {
    expect(() =>
      parseAIWindowModeResponse(content, ["row-2", "row-3"]),
    ).toThrow(message);
  });

  it.each([
    [[], /requires at least one expected translation id/i],
    [[" "], /expected translation id must be non-empty/i],
    [["row-2", "row-2"], /duplicate expected translation id/i],
  ])("rejects invalid expected ids %#", (expectedIds, message) => {
    expect(() =>
      parseAIWindowModeResponse(
        JSON.stringify({
          translations: [{ id: "row-2", text: "Enregistrer" }],
        }),
        expectedIds,
      ),
    ).toThrow(message);
  });
});
