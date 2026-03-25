import { describe, test, expect, beforeEach } from "vitest";
import { TagValidator } from "./TagValidator";
import type { QaIssue, Token } from "./models";

describe("TagValidator", () => {
  let validator: TagValidator;

  beforeEach(() => {
    validator = new TagValidator();
  });

  describe("validate() method signature", () => {
    test("should accept source and target tokens and return ValidationResult", () => {
      const sourceTokens: Token[] = [{ type: "text", content: "Hello world" }];
      const targetTokens: Token[] = [
        { type: "text", content: "Bonjour monde" },
      ];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    test("should return empty arrays when no tags are present", () => {
      const sourceTokens: Token[] = [{ type: "text", content: "Hello world" }];
      const targetTokens: Token[] = [
        { type: "text", content: "Bonjour monde" },
      ];

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

      const suggestion = validator.generateAutoFix(
        issue,
        sourceTokens,
        targetTokens,
      );

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

      const suggestion = validator.generateAutoFix(
        issue,
        sourceTokens,
        targetTokens,
      );

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

    test("should have suggestions array with AutoFixSuggestion objects", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]).toHaveProperty("type");
      expect(result.suggestions[0]).toHaveProperty("description");
      expect(result.suggestions[0]).toHaveProperty("apply");
      expect(typeof result.suggestions[0].apply).toBe("function");
    });
  });

  describe("AutoFixSuggestion interface", () => {
    test("should have type property with valid values", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(result.suggestions[0].type).toMatch(/^(insert|delete|reorder)$/);
    });

    test("should have description property as string", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const result = validator.validate(sourceTokens, targetTokens);

      expect(typeof result.suggestions[0].description).toBe("string");
      expect(result.suggestions[0].description.length).toBeGreaterThan(0);
    });

    test("should have apply function that returns Token array", () => {
      const sourceTokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "text", content: "Hello" },
      ];
      const targetTokens: Token[] = [{ type: "text", content: "Bonjour" }];

      const result = validator.validate(sourceTokens, targetTokens);
      const fixedTokens = result.suggestions[0].apply(targetTokens);

      expect(Array.isArray(fixedTokens)).toBe(true);
      expect(
        fixedTokens.every((token) => "type" in token && "content" in token),
      ).toBe(true);
    });
  });
});
