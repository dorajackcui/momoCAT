import type { QaIssue, Token } from '../models';
import { getAngleTagInfo } from '../tag/AngleTagSyntax';
import { isActualLineBreakTagContent } from '../tag/signature';
import { countValues } from './text';

/** Only tokenizer-produced tags are protected; literal text is never promoted here. */
export function collectProtectedTags(tokens: readonly Token[]): string[] {
  return tokens.flatMap((token) =>
    token.type === 'tag' ? (isActualLineBreakTagContent(token.content) ? [] : [token.content]) : [],
  );
}

function structure(tags: readonly string[]): string[] {
  const stack: string[] = [],
    paths: string[] = [];
  for (const tag of tags) {
    const info = getAngleTagInfo(tag);
    if (!info || info.type === 'standalone' || /^(br|hr|img|input|meta|link)$/i.test(info.name))
      continue;
    if (info.type === 'paired-end') {
      if (stack.pop() !== info.name) return ['INVALID'];
    } else {
      stack.push(info.name);
      paths.push(stack.join('/'));
    }
  }
  return stack.length ? ['INVALID'] : paths.sort();
}

/** All QA and AI callers compare their selected tags with this single set of rules. */
export function checkTagIntegrity(
  source: readonly string[],
  target: readonly string[],
  options: { expectedTagsSignature?: string } = {},
): QaIssue[] {
  const left = countValues(source),
    right = countValues(target);
  const issues: QaIssue[] = [];
  const add = (ruleId: string, message: string) =>
    issues.push({ ruleId, message, severity: 'info' });
  const missing = [...left.keys()].filter((tag) => !right.has(tag));
  const extra = [...right.keys()].filter((tag) => !left.has(tag));
  const changed = [...left].filter(([tag, count]) => right.has(tag) && right.get(tag) !== count);
  if (missing.length) add('tag-missing', `Missing: ${missing.join(', ')}`);
  if (extra.length) add('tag-extra', `Extra: ${extra.join(', ')}`);
  if (changed.length)
    add(
      'tag-count',
      changed.map(([tag, count]) => `${tag}: source ${count}, target ${right.get(tag)}`).join('; '),
    );
  const sourceStructure = structure(source),
    targetStructure = structure(target);
  if (
    sourceStructure[0] !== 'INVALID' &&
    JSON.stringify(sourceStructure) !== JSON.stringify(targetStructure)
  ) {
    add('tag-structure', 'Tag closing or nesting differs from source.');
  }
  const orderChanged =
    options.expectedTagsSignature === undefined
      ? source.join('\u0000') !== target.join('\u0000')
      : options.expectedTagsSignature !== target.join('|');
  if (!issues.length && orderChanged) {
    add('tag-order', `Source: ${source.join(' → ')}; target: ${target.join(' → ')}`);
  }
  return issues;
}
