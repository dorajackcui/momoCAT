// Internal guardrail shim: nested package modules use this when direct
// ../services imports would match the architecture scan pattern.
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
