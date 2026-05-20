// Internal guardrail shim for nested package modules that need service access.
// Prefer direct service imports unless a nested path needs that exception.
export { TBService } from './services/TBService';
export { TMService } from './services/TMService';
export type {
  ConcordanceTMMatch,
  StandardTMMatch,
  TMMatch,
  TMMatchBase,
  TMMatchKind,
} from './services/TMService';
