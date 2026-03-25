export type TokenType = "text" | "tag" | "locked" | "ws";

export type TagType = "paired-start" | "paired-end" | "standalone";

export type ValidationState = "valid" | "error" | "warning";

export interface Token {
  type: TokenType;
  content: string;
  meta?: {
    id?: string;
    tagType?: TagType;
    pairedIndex?: number;
    validationState?: ValidationState;
    [key: string]: unknown;
  };
}

export interface TagMetadata {
  index: number;
  type: TagType;
  pairedIndex?: number;
  isPaired: boolean;
  displayText: string;
  validationState?: ValidationState;
}

export type SegmentStatus =
  | "new"
  | "draft"
  | "translated"
  | "confirmed"
  | "reviewed";

export type QaSeverity = "error" | "warning" | "info";

export interface QaIssue {
  ruleId: string;
  severity: QaSeverity;
  message: string;
}

export interface AutoFixSuggestion {
  type: "insert" | "delete" | "reorder";
  description: string;
  apply: (targetTokens: Token[]) => Token[];
}

export interface ValidationResult {
  issues: QaIssue[];
  suggestions: AutoFixSuggestion[];
}

export interface Segment {
  segmentId: string;
  fileId: number;
  orderIndex: number;
  sourceTokens: Token[];
  targetTokens: Token[];
  status: SegmentStatus;
  tagsSignature: string;
  matchKey: string;
  srcHash: string;
  meta: {
    rowRef?: number;
    context?: string;
    notes?: string[];
    updatedAt: string;
  };
  qaIssues?: QaIssue[];
  autoFixSuggestions?: AutoFixSuggestion[];
}

export interface TMEntry {
  id: string;
  projectId: number;
  srcLang: string;
  tgtLang: string;
  srcHash: string;
  matchKey: string;
  tagsSignature: string;
  sourceTokens: Token[];
  targetTokens: Token[];
  originSegmentId?: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface TermBase {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  createdAt: string;
  updatedAt: string;
}

export interface TBEntry {
  id: string;
  tbId: string;
  srcTerm: string;
  tgtTerm: string;
  srcNorm: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface TBMatch extends TBEntry {
  tbName: string;
  priority: number;
  positions: Array<{ start: number; end: number }>;
}
