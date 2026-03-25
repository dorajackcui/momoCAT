import { describe, expect, beforeEach, it } from "vitest";
import { TagNavigator } from "./TagNavigator";
import type { Token } from "./models";

describe("TagNavigator", () => {
  let navigator: TagNavigator;

  beforeEach(() => {
    navigator = new TagNavigator();
  });

  describe("getTagIndices", () => {
    it("should return empty array for tokens with no tags", () => {
      const tokens: Token[] = [{ type: "text", content: "Hello world" }];

      const indices = navigator.getTagIndices(tokens);
      expect(indices).toEqual([]);
    });

    it("should return indices of all tag tokens", () => {
      const tokens: Token[] = [
        { type: "text", content: "Hello " },
        { type: "tag", content: "<bold>" },
        { type: "text", content: "world" },
        { type: "tag", content: "</bold>" },
      ];

      const indices = navigator.getTagIndices(tokens);
      expect(indices).toEqual([1, 3]);
    });

    it("should handle tokens with only tags", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "tag", content: "{2}" },
        { type: "tag", content: "{3}" },
      ];

      const indices = navigator.getTagIndices(tokens);
      expect(indices).toEqual([0, 1, 2]);
    });

    it("should handle mixed token types", () => {
      const tokens: Token[] = [
        { type: "text", content: "Start " },
        { type: "tag", content: "{1}" },
        { type: "text", content: " middle " },
        { type: "tag", content: "<bold>" },
        { type: "text", content: "text" },
        { type: "tag", content: "</bold>" },
        { type: "text", content: " end" },
      ];

      const indices = navigator.getTagIndices(tokens);
      expect(indices).toEqual([1, 3, 5]);
    });
  });

  describe("focusNextTag", () => {
    it("should return current index when no tags exist", () => {
      const tokens: Token[] = [{ type: "text", content: "Hello world" }];

      const nextIndex = navigator.focusNextTag(0, tokens);
      expect(nextIndex).toBe(0);
    });

    it("should move to next tag after current position", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
        { type: "text", content: "world" },
        { type: "tag", content: "{3}" },
      ];

      const nextIndex = navigator.focusNextTag(0, tokens);
      expect(nextIndex).toBe(2);
    });

    it("should wrap to first tag when at the end", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
      ];

      const nextIndex = navigator.focusNextTag(2, tokens);
      expect(nextIndex).toBe(0);
    });

    it("should wrap to first tag when past the last tag", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
        { type: "text", content: "world" },
      ];

      const nextIndex = navigator.focusNextTag(3, tokens);
      expect(nextIndex).toBe(0);
    });

    it("should handle single tag", () => {
      const tokens: Token[] = [
        { type: "text", content: "Hello " },
        { type: "tag", content: "{1}" },
        { type: "text", content: " world" },
      ];

      // From before the tag
      expect(navigator.focusNextTag(0, tokens)).toBe(1);

      // From the tag itself (wraps around)
      expect(navigator.focusNextTag(1, tokens)).toBe(1);

      // From after the tag (wraps around)
      expect(navigator.focusNextTag(2, tokens)).toBe(1);
    });
  });

  describe("focusPreviousTag", () => {
    it("should return current index when no tags exist", () => {
      const tokens: Token[] = [{ type: "text", content: "Hello world" }];

      const prevIndex = navigator.focusPreviousTag(0, tokens);
      expect(prevIndex).toBe(0);
    });

    it("should move to previous tag before current position", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
        { type: "text", content: "world" },
        { type: "tag", content: "{3}" },
      ];

      const prevIndex = navigator.focusPreviousTag(4, tokens);
      expect(prevIndex).toBe(2);
    });

    it("should wrap to last tag when at the beginning", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
      ];

      const prevIndex = navigator.focusPreviousTag(0, tokens);
      expect(prevIndex).toBe(2);
    });

    it("should wrap to last tag when before the first tag", () => {
      const tokens: Token[] = [
        { type: "text", content: "Start " },
        { type: "tag", content: "{1}" },
        { type: "text", content: "Hello" },
        { type: "tag", content: "{2}" },
      ];

      const prevIndex = navigator.focusPreviousTag(0, tokens);
      expect(prevIndex).toBe(3);
    });

    it("should handle single tag", () => {
      const tokens: Token[] = [
        { type: "text", content: "Hello " },
        { type: "tag", content: "{1}" },
        { type: "text", content: " world" },
      ];

      // From before the tag (wraps around)
      expect(navigator.focusPreviousTag(0, tokens)).toBe(1);

      // From the tag itself (wraps around)
      expect(navigator.focusPreviousTag(1, tokens)).toBe(1);

      // From after the tag
      expect(navigator.focusPreviousTag(2, tokens)).toBe(1);
    });
  });

  describe("navigation wrapping behavior", () => {
    it("should correctly wrap forward and backward through multiple tags", () => {
      const tokens: Token[] = [
        { type: "tag", content: "{1}" },
        { type: "text", content: "A" },
        { type: "tag", content: "{2}" },
        { type: "text", content: "B" },
        { type: "tag", content: "{3}" },
      ];

      // Forward navigation with wrapping
      let currentIndex = 0;
      currentIndex = navigator.focusNextTag(currentIndex, tokens);
      expect(currentIndex).toBe(2); // Move to tag at index 2

      currentIndex = navigator.focusNextTag(currentIndex, tokens);
      expect(currentIndex).toBe(4); // Move to tag at index 4

      currentIndex = navigator.focusNextTag(currentIndex, tokens);
      expect(currentIndex).toBe(0); // Wrap to tag at index 0

      // Backward navigation with wrapping
      currentIndex = navigator.focusPreviousTag(currentIndex, tokens);
      expect(currentIndex).toBe(4); // Wrap to tag at index 4

      currentIndex = navigator.focusPreviousTag(currentIndex, tokens);
      expect(currentIndex).toBe(2); // Move to tag at index 2

      currentIndex = navigator.focusPreviousTag(currentIndex, tokens);
      expect(currentIndex).toBe(0); // Move to tag at index 0
    });
  });

  describe("edge cases", () => {
    it("should handle empty token array", () => {
      const tokens: Token[] = [];

      expect(navigator.getTagIndices(tokens)).toEqual([]);
      expect(navigator.focusNextTag(0, tokens)).toBe(0);
      expect(navigator.focusPreviousTag(0, tokens)).toBe(0);
    });

    it("should handle consecutive tags", () => {
      const tokens: Token[] = [
        { type: "tag", content: "<bold>" },
        { type: "tag", content: "<italic>" },
        { type: "tag", content: "</italic>" },
        { type: "tag", content: "</bold>" },
      ];

      const indices = navigator.getTagIndices(tokens);
      expect(indices).toEqual([0, 1, 2, 3]);

      // Navigate forward through consecutive tags
      expect(navigator.focusNextTag(0, tokens)).toBe(1);
      expect(navigator.focusNextTag(1, tokens)).toBe(2);
      expect(navigator.focusNextTag(2, tokens)).toBe(3);
      expect(navigator.focusNextTag(3, tokens)).toBe(0); // Wrap

      // Navigate backward through consecutive tags
      expect(navigator.focusPreviousTag(3, tokens)).toBe(2);
      expect(navigator.focusPreviousTag(2, tokens)).toBe(1);
      expect(navigator.focusPreviousTag(1, tokens)).toBe(0);
      expect(navigator.focusPreviousTag(0, tokens)).toBe(3); // Wrap
    });
  });
});
