import type { QaIssue, Token } from '../models';
import { checkTagIntegrity, collectProtectedTags } from './tagRules';

/** Fixed token checks within QA, independent of optional project checks. */
export function checkProtectedTokens(
  source: readonly Token[],
  target: readonly Token[],
  tagPolicy: 'default' | 'none' = 'default',
): QaIssue[] {
  if (tagPolicy === 'none') return [];
  return checkTagIntegrity(collectProtectedTags(source), collectProtectedTags(target)).filter(
    (issue) => issue.ruleId !== 'tag-order',
  );
}
