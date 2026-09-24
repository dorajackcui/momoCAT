import {
  findTermPositionsInText,
  type TermMatchPosition,
  type TermSearchOptions,
} from './termMatching';
import { normalizeTextWithIndexMap, resolveTermLocale } from './termNormalization';

interface Node {
  children: Map<string, Node>;
  terms: number[];
  failure?: Node;
  output?: Node;
}

const node = (): Node => ({ children: new Map(), terms: [] });

export interface StrictTermRecognizerMatch<T> {
  entry: T;
  positions: TermMatchPosition[];
}

/** Multi-term recall with the existing strict matcher's locale, boundary and offset rules. */
export class StrictTermRecognizer<T> {
  private readonly roots = new Map<string | undefined, Node>();
  private readonly terms: Array<{ entry: T; text: string; locale?: string }>;

  constructor(entries: readonly T[], termText: (entry: T) => string, options?: TermSearchOptions) {
    this.terms = entries.map((entry) => {
      const text = termText(entry);
      return { entry, text, locale: resolveTermLocale(text, options?.locale) };
    });
    this.terms.forEach((term, index) => {
      const normalized = normalizeTextWithIndexMap(term.text, term.locale).text;
      if (!normalized) return;
      let root = this.roots.get(term.locale);
      if (!root) this.roots.set(term.locale, (root = node()));
      let current = root;
      // Use UTF-16 units, just like String.indexOf in the final matcher.
      for (let offset = 0; offset < normalized.length; offset++) {
        const char = normalized[offset];
        let child = current.children.get(char);
        if (!child) current.children.set(char, (child = node()));
        current = child;
      }
      current.terms.push(index);
    });
    for (const root of this.roots.values()) this.buildFailureLinks(root);
  }

  scan(text: string): StrictTermRecognizerMatch<T>[] {
    const candidates = new Set<number>();
    for (const [locale, root] of this.roots) {
      const normalized = normalizeTextWithIndexMap(text, locale).text;
      let current = root;
      for (let offset = 0; offset < normalized.length; offset++) {
        const char = normalized[offset];
        while (current !== root && !current.children.has(char)) current = current.failure!;
        current = current.children.get(char) ?? root;
        for (let output: Node | undefined = current; output; output = output.output)
          for (const index of output.terms) candidates.add(index);
      }
    }
    // Keep entry order: consumers use it for TB priority and QA finding order.
    return [...candidates]
      .sort((a, b) => a - b)
      .flatMap((index) => {
        const term = this.terms[index];
        // Only actual substring candidates pay for word segmentation and raw offsets.
        // Reusing the final matcher preserves non-overlapping occurrences as well.
        const positions = findTermPositionsInText(text, term.text, { locale: term.locale });
        return positions.length ? [{ entry: term.entry, positions }] : [];
      });
  }

  private buildFailureLinks(root: Node): void {
    const queue = [...root.children.values()];
    for (const child of queue) child.failure = root;
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const [char, child] of current.children) {
        let failure = current.failure;
        while (failure && !failure.children.has(char)) failure = failure.failure;
        child.failure = failure?.children.get(char) ?? root;
        // Link suffix outputs instead of copying them into every trie node.
        child.output = child.failure.terms.length ? child.failure : child.failure.output;
        queue.push(child);
      }
    }
  }
}
