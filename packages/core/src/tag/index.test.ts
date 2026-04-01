import { describe, expect, it } from "vitest";
import type { TagMetadata, TagType, ValidationState } from "../models";
import {
  computeTagsSignature,
  formatTagAsMemoQMarker,
  getTagDisplayInfo,
  parseDisplayTextToTokens,
  parseEditorTextToTokens,
  serializeTokensToEditorText,
} from "./index";

describe("CAT Core Tokenizer", () => {
  it("parses plain text without tags", () => {
    const tokens = parseDisplayTextToTokens("Hello world");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: "text", content: "Hello world" });
  });

  it("parses text with multiple tag types", () => {
    const tokens = parseDisplayTextToTokens("Hello {1} <b>world</b> %s");
    expect(tokens).toHaveLength(8);
    expect(tokens[1]).toEqual({
      type: "tag",
      content: "{1}",
      meta: { id: "{1}" },
    });
    expect(tokens[3]).toEqual({
      type: "tag",
      content: "<b>",
      meta: { id: "<b>" },
    });
    expect(tokens[5]).toEqual({
      type: "tag",
      content: "</b>",
      meta: { id: "</b>" },
    });
    expect(tokens[7]).toEqual({
      type: "tag",
      content: "%s",
      meta: { id: "%s" },
    });
  });

  it("supports custom regex patterns for tag recognition", () => {
    const tokens = parseDisplayTextToTokens("prefix @@NAME@@ suffix", [
      /@@[A-Z_]+@@/g,
    ]);
    expect(tokens).toEqual([
      { type: "text", content: "prefix " },
      { type: "tag", content: "@@NAME@@", meta: { id: "@@NAME@@" } },
      { type: "text", content: " suffix" },
    ]);
  });

  it("computes consistent tags signature", () => {
    const signature = computeTagsSignature([
      { type: "text", content: "Hello " },
      { type: "tag", content: "{1}", meta: { id: "{1}" } },
      { type: "text", content: " world " },
      { type: "tag", content: "{2}", meta: { id: "{2}" } },
    ]);
    expect(signature).toBe("{1}|{2}");
  });
});

describe("Editor Tag Marker Conversion", () => {
  const sourceTokens = [
    { type: "text", content: "A " },
    { type: "tag", content: "<b>" },
    { type: "text", content: "B" },
    { type: "tag", content: "</b>" },
    { type: "text", content: " C " },
    { type: "tag", content: "{1}" },
  ] as const;

  const sourceTokensWithDuplicate = [
    { type: "text", content: "A " },
    { type: "tag", content: "<b>" },
    { type: "text", content: "B" },
    { type: "tag", content: "<b>" },
    { type: "text", content: " C " },
    { type: "tag", content: "{1}" },
  ] as const;

  it("formats memoQ-style marker by tag type", () => {
    expect(formatTagAsMemoQMarker("<b>", 1)).toBe("{1>");
    expect(formatTagAsMemoQMarker("</b>", 2)).toBe("<2}");
    expect(formatTagAsMemoQMarker("</>", 2)).toBe("<2}");
    expect(formatTagAsMemoQMarker("{1}", 3)).toBe("{3}");
  });

  it("serializes tokens to memoQ-style editor text", () => {
    const targetTokens = [
      { type: "text", content: "Hello " },
      { type: "tag", content: "<b>" },
      { type: "text", content: "World" },
      { type: "tag", content: "</b>" },
      { type: "text", content: "!" },
    ];

    expect(serializeTokensToEditorText(targetTokens, [...sourceTokens])).toBe(
      "Hello {1>World<2}!",
    );
  });

  it("serializes nameless closing tags as paired-end markers", () => {
    const sourceWithNamelessClosingTag = [
      { type: "tag", content: "<Yellow>" },
      { type: "text", content: "示例文本" },
      { type: "tag", content: "</>" },
    ];
    const targetTokens = [
      { type: "tag", content: "<Yellow>" },
      { type: "text", content: "Wanxiang" },
      { type: "tag", content: "</>" },
    ];

    expect(
      serializeTokensToEditorText(targetTokens, sourceWithNamelessClosingTag),
    ).toBe("{1>Wanxiang<2}");
  });

  it("parses memoQ-style markers back to source tags", () => {
    const tokens = parseEditorTextToTokens("X {1>Y<2} Z {3}", [
      ...sourceTokens,
    ]);
    expect(tokens).toEqual([
      { type: "text", content: "X " },
      { type: "tag", content: "<b>", meta: { id: "<b>" } },
      { type: "text", content: "Y" },
      { type: "tag", content: "</b>", meta: { id: "</b>" } },
      { type: "text", content: " Z " },
      { type: "tag", content: "{1}", meta: { id: "{1}" } },
    ]);
  });

  it("assigns the same marker number to duplicate tag content", () => {
    const targetTokens = [
      { type: "text", content: "Hello " },
      { type: "tag", content: "<b>" },
      { type: "text", content: "World" },
      { type: "tag", content: "<b>" },
    ];

    expect(
      serializeTokensToEditorText(targetTokens, [...sourceTokensWithDuplicate]),
    ).toBe("Hello {1>World{1>");
  });

  it("parses marker numbers against unique tag contents", () => {
    const tokens = parseEditorTextToTokens("X {1> Y {2}", [
      ...sourceTokensWithDuplicate,
    ]);
    expect(tokens).toEqual([
      { type: "text", content: "X " },
      { type: "tag", content: "<b>", meta: { id: "<b>" } },
      { type: "text", content: " Y " },
      { type: "tag", content: "{1}", meta: { id: "{1}" } },
    ]);
  });

  it("keeps unknown marker index as plain text", () => {
    expect(
      parseEditorTextToTokens("Bad {999>} marker", [...sourceTokens]),
    ).toEqual([{ type: "text", content: "Bad {999>} marker" }]);
  });

  it("parses editor markers with custom marker regex", () => {
    const tokens = parseEditorTextToTokens("X [[1]] Y", [...sourceTokens], {
      editorMarkerPatterns: [
        { type: "standalone", regex: /\[\[(?<index>\d+)\]\]/g },
      ],
    });
    expect(tokens).toEqual([
      { type: "text", content: "X " },
      { type: "tag", content: "<b>", meta: { id: "<b>" } },
      { type: "text", content: " Y" },
    ]);
  });
});

describe("TagMetadata Interface", () => {
  it("supports tag metadata shapes", () => {
    const pairedStart: TagMetadata = {
      index: 0,
      type: "paired-start",
      pairedIndex: 2,
      isPaired: true,
      displayText: "[1",
      validationState: "valid",
    };
    const standalone: TagMetadata = {
      index: 1,
      type: "standalone",
      isPaired: false,
      displayText: "⟨1⟩",
    };
    const pairedEnd: TagMetadata = {
      index: 3,
      type: "paired-end",
      isPaired: false,
      displayText: "3]",
      validationState: "error",
    };

    expect(pairedStart.type).toBe("paired-start");
    expect(standalone.type).toBe("standalone");
    expect(pairedEnd.type).toBe("paired-end");
  });

  it("allows all valid TagType and ValidationState values", () => {
    const types: TagType[] = ["paired-start", "paired-end", "standalone"];
    const states: ValidationState[] = ["valid", "error", "warning"];

    expect(types).toHaveLength(3);
    expect(states).toHaveLength(3);
  });
});

describe("getTagDisplayInfo", () => {
  it("identifies paired opening tags", () => {
    expect(getTagDisplayInfo("<bold>", 0)).toEqual({
      display: "[1",
      type: "paired-start",
    });
    expect(getTagDisplayInfo("<span-class-name>", 2)).toEqual({
      display: "[3",
      type: "paired-start",
    });
  });

  it("identifies paired closing tags", () => {
    expect(getTagDisplayInfo("</bold>", 1)).toEqual({
      display: "2]",
      type: "paired-end",
    });
    expect(getTagDisplayInfo("</h1>", 7)).toEqual({
      display: "8]",
      type: "paired-end",
    });
  });

  it("identifies standalone tags", () => {
    expect(getTagDisplayInfo("<br/>", 0)).toEqual({
      display: "⟨1⟩",
      type: "standalone",
    });
    expect(getTagDisplayInfo("{5}", 2)).toEqual({
      display: "⟨5⟩",
      type: "standalone",
    });
    expect(getTagDisplayInfo("%1$s", 2)).toEqual({
      display: "⟨3⟩",
      type: "standalone",
    });
  });

  it("handles edge cases and mixed examples", () => {
    expect(getTagDisplayInfo("</tag>", 99)).toEqual({
      display: "100]",
      type: "paired-end",
    });
    expect(getTagDisplayInfo("<img-src/>", 0)).toEqual({
      display: "⟨1⟩",
      type: "standalone",
    });
    expect(
      ["<bold>", "world", "</bold>", "{1}", "%s"].map((tag, index) =>
        getTagDisplayInfo(tag, index),
      ),
    ).toEqual([
      { display: "[1", type: "paired-start" },
      { display: "⟨2⟩", type: "standalone" },
      { display: "3]", type: "paired-end" },
      { display: "⟨1⟩", type: "standalone" },
      { display: "⟨5⟩", type: "standalone" },
    ]);
  });
});
