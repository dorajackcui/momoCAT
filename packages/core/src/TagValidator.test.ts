import { describe, test, expect, beforeEach } from "vitest";
import { TagValidator } from "./TagValidator";
import { parseDisplayTextToTokens, parseEditorTextToTokens } from "./tag";
import type { QaIssue, Token } from "./models";

describe("TagValidator", () => {
  let validator: TagValidator;

  beforeEach(() => {
    validator = new TagValidator();
  });

  describe("validate() method signature", () => {
    test("protects Unicode angle tags and requires their original spelling", () => {
      const source = parseDisplayTextToTokens("❮b❯Hello❰/b❱");
      const target = parseEditorTextToTokens("{1>Bonjour<2}", source);

      expect(validator.validate(source, target).issues).toEqual([]);
      expect(validator.validate(source, parseDisplayTextToTokens("Bonjour")).issues).toEqual([
        expect.objectContaining({ ruleId: "tag-missing" }),
        expect.objectContaining({ ruleId: "tag-structure" }),
      ]);
      expect(validator.validate(source, parseDisplayTextToTokens("<b>Bonjour</b>")).issues).toEqual(
        [
          expect.objectContaining({ ruleId: "tag-missing" }),
          expect.objectContaining({ ruleId: "tag-extra" }),
        ],
      );
    });

    test("should accept source and target tokens and return ValidationResult", () => {
      const sourceTokens: Token[] = [{ type: "text", content: "Hello world" }];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour monde" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    test("should return empty arrays when no tags are present", () => {
      const sourceTokens: Token[] = [{ type: "text", content: "Hello world" }];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour monde" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result.issues).toHaveLength(0);
      expect(result.suggestions).toHaveLength(0);
    });

    test("should return empty arrays when tags match perfectly", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "</bold>" },
      ];
      const targetTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Bonjour" },
        { type: "tag", content: "</bold>" },
      ];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result.issues).toHaveLength(0);
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe("generateAutoFix() method signature", () => {
    test("should accept issue, source tokens, and target tokens", () => {
      const issue: QaIssue = {
        ruleId: "tag-missing",
        severity: "error",
        message: "Missing tags: <bold>",
      };
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "</bold>" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const suggestion = validator.generateAutoFix(issue, sourceTokens, targetTokens);

      expect(suggestion).toBeDefined();
    });

    test("should return null for unknown ruleId", () => {
      const issue: QaIssue = {
        ruleId: "unknown-rule",
        severity: "error",
        message: "Unknown error",
      };
      const sourceTokens: Token[] = [{ type: "text", content: "Hello" }];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const suggestion = validator.generateAutoFix(issue, sourceTokens, targetTokens);

      expect(suggestion).toBeNull();
    });
  });

  describe("ValidationResult interface", () => {
    test("should have issues array with QaIssue objects", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]).toHaveProperty("ruleId");
      expect(result.issues[0]).toHaveProperty("severity");
      expect(result.issues[0]).toHaveProperty("message");
    });

    test("keeps the legacy result shape without generating unsafe tag repairs", () => {
      const source: Token[] = [{ type: "tag", content: "<b>" }];
      const result = validator.validate(source, []);
      expect(result.issues.some((issue) => issue.ruleId === "tag-missing")).toBe(true);
      expect(result.suggestions).toEqual([]);
      expect(validator.generateAutoFix(result.issues[0], source, [])).toBeNull();
    });
  });
});
