import type { TagType } from '../models';

export interface EditorMarkerPattern {
  /**
   * Marker semantic type. Used for ordering and debugging.
   */
  type: TagType;
  /**
   * Regex that should capture marker index as either:
   * - named group: (?<index>\d+)
   * - first capture group: (\d+)
   */
  regex: RegExp;
}

export interface TagPatternRegistryConfig {
  /**
   * Patterns treated as raw tag tokens in display/editor text.
   */
  displayTagPatterns: RegExp[];
  /**
   * Patterns treated as memoQ-like indexed markers.
   */
  editorMarkerPatterns: EditorMarkerPattern[];
}

/**
 * Central, file-based configuration for tag recognition.
 *
 * You can manually add/adjust regexes here to support new tag formats.
 */
export const TAG_PATTERN_REGISTRY: TagPatternRegistryConfig = {
  displayTagPatterns: [
    /\{[^{}]+\}/g,
    /<[^>]+>/g,
    /%(?:\d+\$)?[-#+0]*\d*(?:\.\d+)?[hlLzjt]*[diuoxXfFeEgGaAcspn%]/g
  ],
  editorMarkerPatterns: [
    { type: 'paired-start', regex: /\{(?<index>\d+)>/g },
    { type: 'paired-end', regex: /<(?<index>\d+)\}/g },
    { type: 'standalone', regex: /\{(?<index>\d+)\}/g }
  ]
};

const ensureGlobalRegex = (regex: RegExp): RegExp => {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
};

const DEFAULT_DISPLAY_TAG_PATTERNS = TAG_PATTERN_REGISTRY.displayTagPatterns.map(ensureGlobalRegex);
const DEFAULT_EDITOR_MARKER_PATTERNS = TAG_PATTERN_REGISTRY.editorMarkerPatterns.map(pattern => ({
  ...pattern,
  regex: ensureGlobalRegex(pattern.regex)
}));

export const getDisplayTagPatterns = (customPatterns?: RegExp[]): RegExp[] => {
  const patterns = customPatterns && customPatterns.length > 0
    ? customPatterns
    : DEFAULT_DISPLAY_TAG_PATTERNS;
  if (patterns === DEFAULT_DISPLAY_TAG_PATTERNS) return patterns;
  return patterns.map(ensureGlobalRegex);
};

export const getEditorMarkerPatterns = (customPatterns?: EditorMarkerPattern[]): EditorMarkerPattern[] => {
  const patterns = customPatterns && customPatterns.length > 0
    ? customPatterns
    : DEFAULT_EDITOR_MARKER_PATTERNS;

  if (patterns === DEFAULT_EDITOR_MARKER_PATTERNS) return patterns;

  return patterns.map(pattern => ({
    ...pattern,
    regex: ensureGlobalRegex(pattern.regex)
  }));
};
