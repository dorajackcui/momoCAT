import type { TagType } from '../models';

export interface TagDisplayInfo {
  display: string;
  type: TagType;
}

export function getTagDisplayInfo(tagContent: string, index: number): TagDisplayInfo {
  const pairedStartMatch = tagContent.match(/^<([^/>]+)>$/);
  const pairedEndMatch = tagContent.match(/^<\/([^>]+)>$/);

  if (pairedStartMatch) {
    return {
      display: `[${index + 1}`,
      type: 'paired-start',
    };
  }

  if (pairedEndMatch) {
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
