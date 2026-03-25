import { describe, expect, it } from "vitest";
import type { Segment, TBMatch } from "../models";
import { validateSegmentTags, validateSegmentTerminology } from "./index";

function buildSegment(
  sourceText: string,
  targetText: string,
  status: "new" | "draft" = "draft",
): Segment {
  return {
    segmentId: "seg-term",
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: "text", content: sourceText }],
    targetTokens: targetText ? [{ type: "text", content: targetText }] : [],
    status,
    tagsSignature: "",
    matchKey: sourceText.toLowerCase(),
    srcHash: sourceText.toLowerCase(),
    meta: { updatedAt: new Date().toISOString() },
  };
}

describe("Tag Integrity QA", () => {
  it("validates missing and extra tags correctly", () => {
    const sourceTokens = [
      { type: "text", content: "Hello " },
      { type: "tag", content: "{1}" },
      { type: "text", content: " world" },
    ];
    const segment = {
      ...buildSegment("Hello {1} world", ""),
      sourceTokens,
      targetTokens: [{ type: "text", content: "你好" }],
      tagsSignature: "{1}",
    };

    let issues = validateSegmentTags(segment);
    expect(issues[0].ruleId).toBe("tag-missing");

    segment.targetTokens = [
      { type: "tag", content: "{1}" },
      { type: "text", content: "你好" },
    ];
    issues = validateSegmentTags(segment);
    expect(issues).toHaveLength(0);

    segment.targetTokens.push({ type: "tag", content: "{2}" });
    issues = validateSegmentTags(segment);
    expect(issues[0].ruleId).toBe("tag-extra");
  });
});

describe("Terminology QA", () => {
  it("creates warning when TB matched term is missing from target text", () => {
    const segment = buildSegment(
      "Please keep your API key secure.",
      "Veuillez garder votre clé en sécurité.",
    );
    const termMatches: TBMatch[] = [
      {
        srcTerm: "API key",
        tgtTerm: "clé API",
        srcNorm: "api key",
        tbName: "Main TB",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("tb-term-missing");
    expect(issues[0].severity).toBe("warning");
  });

  it("passes when target already contains expected latin TB term", () => {
    const segment = buildSegment(
      "Please keep your API key secure.",
      "Veuillez garder votre clé API en sécurité.",
    );
    const termMatches: TBMatch[] = [
      {
        srcTerm: "API key",
        tgtTerm: "clé API",
        srcNorm: "api key",
        tbName: "Main TB",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches);
    expect(issues).toHaveLength(0);
  });

  it("passes when target already contains expected cjk TB term", () => {
    const segment = buildSegment("请打开设置页面。", "请打开设置页面。");
    const termMatches: TBMatch[] = [
      {
        srcTerm: "设置",
        tgtTerm: "设置",
        srcNorm: "设置",
        tbName: "UI TB",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches);
    expect(issues).toHaveLength(0);
  });

  it("passes when target term is split by tags because QA uses text-only matching", () => {
    const segment = {
      ...buildSegment("请使用 API key 登录。", ""),
      targetTokens: [
        { type: "text", content: "Veuillez utiliser la clé " },
        { type: "tag", content: "<b>" },
        { type: "text", content: "API" },
        { type: "tag", content: "</b>" },
        { type: "text", content: " pour continuer." },
      ],
    };
    const termMatches: TBMatch[] = [
      {
        srcTerm: "API key",
        tgtTerm: "clé API",
        srcNorm: "api key",
        tbName: "Main TB",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches);
    expect(issues).toHaveLength(0);
  });

  it("passes when target already contains width-normalized preferred term", () => {
    const segment = buildSegment(
      "Please keep your API key secure.",
      "Veuillez garder votre clé ＡＰＩ en sécurité.",
    );
    const termMatches: TBMatch[] = [
      {
        srcTerm: "API key",
        tgtTerm: "clé API",
        srcNorm: "api key",
        tbName: "Main TB",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches, {
      targetLocale: "fr-FR",
    });
    expect(issues).toHaveLength(0);
  });

  it("deduplicates repeated matches of the same normalized term and target term", () => {
    const segment = buildSegment("API key is required.", "凭证是必须的。");
    const termMatches: TBMatch[] = [
      {
        srcTerm: "API key",
        tgtTerm: "API 密钥",
        srcNorm: "api key",
        tbName: "TB A",
        id: "tb-1",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 1,
        positions: [],
      },
      {
        srcTerm: "api key",
        tgtTerm: "API 密钥",
        srcNorm: "api key",
        tbName: "TB B",
        id: "tb-2",
        tbId: "tb",
        createdAt: "",
        updatedAt: "",
        usageCount: 0,
        priority: 2,
        positions: [],
      },
    ];

    const issues = validateSegmentTerminology(segment, termMatches);
    expect(issues).toHaveLength(1);
  });
});
