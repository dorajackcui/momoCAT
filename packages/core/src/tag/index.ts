export { TagManager } from './TagManager';
export { TagNavigator } from './TagNavigator';
export {
  formatTagAsMemoQMarker,
  parseDisplayTextToTokens,
  parseEditorTextToTokens,
  serializeTokensToEditorText,
  type ParseDisplayTextOptions,
  type ParseEditorTextOptions,
  type TagPolicy,
} from './TagCodec';
export {
  TAG_PATTERN_REGISTRY,
  getDisplayTagPatterns,
  getEditorMarkerPatterns,
  type EditorMarkerPattern,
  type TagPatternRegistryConfig,
} from './TagPatternRegistry';
export { computeTagsSignature, extractTags } from './signature';
export { getTagDisplayInfo, type TagDisplayInfo } from './display';
