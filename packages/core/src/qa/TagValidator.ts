import type { AutoFixSuggestion, QaIssue, Token, ValidationResult } from '../models';
import { validateTagIntegrityTokens } from './tagIntegrity';

export class TagValidator {
  validate(sourceTokens: Token[], targetTokens: Token[]): ValidationResult {
    const issues = validateTagIntegrityTokens(sourceTokens, targetTokens);
    const suggestions: AutoFixSuggestion[] = [];

    const sourceTags = sourceTokens.filter((token) => token.type === 'tag');
    const targetTags = targetTokens.filter((token) => token.type === 'tag');

    const missing = sourceTags.filter(
      (sourceTag) => !targetTags.some((targetTag) => targetTag.content === sourceTag.content),
    );
    if (missing.length > 0) {
      suggestions.push({
        type: 'insert',
        description: `Insert missing tags: ${missing.map((tag) => tag.content).join(', ')}`,
        apply: (tokens: Token[]) => {
          const nextTokens = [...tokens];
          for (const tag of missing) {
            nextTokens.push({
              type: 'tag',
              content: tag.content,
              meta: { id: tag.content },
            });
          }
          return nextTokens;
        },
      });
    }

    const extra = targetTags.filter(
      (targetTag) => !sourceTags.some((sourceTag) => sourceTag.content === targetTag.content),
    );
    if (extra.length > 0) {
      suggestions.push({
        type: 'delete',
        description: `Remove extra tags: ${extra.map((tag) => tag.content).join(', ')}`,
        apply: (tokens: Token[]) =>
          tokens.filter(
            (token) =>
              token.type !== 'tag' || sourceTags.some((sourceTag) => sourceTag.content === token.content),
          ),
      });
    }

    if (issues.some((issue) => issue.ruleId === 'tag-order')) {
      suggestions.push({
        type: 'reorder',
        description: 'Reorder tags to match source sequence',
        apply: (tokens: Token[]) => tokens,
      });
    }

    return { issues, suggestions };
  }

  generateAutoFix(
    issue: QaIssue,
    sourceTokens: Token[],
    targetTokens: Token[],
  ): AutoFixSuggestion | null {
    const result = this.validate(sourceTokens, targetTokens);
    const ruleIdToType: Record<string, AutoFixSuggestion['type']> = {
      'tag-missing': 'insert',
      'tag-extra': 'delete',
      'tag-order': 'reorder',
    };

    const suggestionType = ruleIdToType[issue.ruleId];
    if (!suggestionType) return null;

    return result.suggestions.find((suggestion) => suggestion.type === suggestionType) ?? null;
  }
}
