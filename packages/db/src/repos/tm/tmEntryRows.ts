import type { TMEntryRow } from '../../types';

export type TMEntryDbRow = Omit<TMEntryRow, 'sourceTokens' | 'targetTokens'> & {
  sourceTokensJson: string;
  targetTokensJson: string;
};

export type TMRecallDbRow = TMEntryDbRow & {
  ftsSrcText: string;
  ftsTgtText: string;
};

export interface TMFtsReplacementRow {
  tmId: string;
  srcText: string;
  tgtText: string;
  tmEntryId: string;
}

export function mapTMEntryDbRow(row: TMEntryDbRow): TMEntryRow {
  return {
    ...row,
    sourceTokens: JSON.parse(row.sourceTokensJson),
    targetTokens: JSON.parse(row.targetTokensJson),
  };
}
