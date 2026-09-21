import type { TagType } from '../models';
import { getAngleTagInfo } from './AngleTagSyntax';

export interface TagDisplayInfo {
  display: string;
  type: TagType;
}

export function getTagDisplayInfo(tagContent: string, index: number): TagDisplayInfo {
  const angleTag = getAngleTagInfo(tagContent);

  if (angleTag?.type === 'paired-start') {
    return {
      display: `[${index + 1}`,
      type: 'paired-start',
    };
  }

  if (angleTag?.type === 'paired-end') {
    return {
      display: `${index + 1}]`,
      type: 'paired-end',
    };
  }

  let displayNum = String(index + 1);
  const bracketMatch = tagContent.match(/^\{(\d+)\}$/);
  if (bracketMatch) {
    displayNum = bracketMatch[1];
  }

  return {
    display: `⟨${displayNum}⟩`,
    type: 'standalone',
  };
}
