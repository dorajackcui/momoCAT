import type { AutoFixSuggestion, QaIssue, Token, ValidationResult } from '../models';
import { validateTagIntegrityTokens } from './tagIntegrity';

/** Compatibility facade over the shared protected-token rules. */
export class TagValidator {
  validate(sourceTokens: Token[], targetTokens: Token[]): ValidationResult {
    return { issues: validateTagIntegrityTokens(sourceTokens, targetTokens), suggestions: [] };
  }

  /** @deprecated Tag placement requires translation context; no automatic repairs are generated. */
  generateAutoFix(
    _issue: QaIssue,
    _sourceTokens: Token[],
    _targetTokens: Token[],
  ): AutoFixSuggestion | null {
    return null;
  }
}
