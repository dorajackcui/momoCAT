# Newline Protected Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert real `\r` and `\n` characters into `{n}` protected markers in the default CAT token flow, then restore them after MT responses are parsed.

**Architecture:** Keep the behavior in `@cat/core`, where token parsing, editor-marker serialization, editor-marker parsing, and tag QA already live. Headless MT paths should benefit automatically because they already use `parseDisplayTextToTokens`, `serializeTokensToEditorText`, `parseEditorTextToTokens`, and `TagValidator`.

**Tech Stack:** TypeScript, Vitest, `@cat/core/tag`, `@cat/core/qa`, `@cat/localization` MT module tests.

---

## File Structure

- Modify `packages/core/src/tag/index.test.ts`: add failing coverage for parsing real CR/LF, serializing them as `{n}` markers, parsing them back, and keeping `tagPolicy: none` plain.
- Modify `packages/core/src/qa/index.test.ts`: add failing coverage proving a missing repeated newline marker is an error, not only a warning.
- Modify `packages/localization/src/modules/MTModule.test.ts`: add failing coverage for prompt payload markerization and retry when a repeated newline marker is dropped.
- Modify `packages/core/src/tag/TagCodec.ts`: split real CR/LF into protected standalone tag tokens under default tag policy, and use an occurrence-aware marker resolver during serialization.
- Modify `packages/core/src/tag/TagMapper.ts`: keep normal duplicate tag behavior, but allocate separate marker numbers for repeated newline token occurrences.
- Modify `packages/core/src/qa/tagIntegrity.ts`: count duplicate tag occurrences when computing missing and extra tags so repeated protected newlines can trigger MT retry.

## Task 1: Write Failing Protected Newline Tests

**Files:**
- Modify: `packages/core/src/tag/index.test.ts`
- Modify: `packages/core/src/qa/index.test.ts`
- Modify: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Add display serialization import to core tag tests**

In `packages/core/src/tag/index.test.ts`, add this import below the existing model import:

```ts
import { serializeTokensToDisplayText } from "../text";
```

- [ ] **Step 2: Add default and none policy newline tokenizer tests**

In `packages/core/src/tag/index.test.ts`, add these tests inside `describe("CAT Core Tokenizer", ...)` after the existing `"parses text with multiple tag types"` test:

```ts
  it("parses real CR and LF as protected standalone tags under default policy", () => {
    const tokens = parseDisplayTextToTokens("A\r\nB\nC\rD");

    expect(tokens).toEqual([
      { type: "text", content: "A" },
      { type: "tag", content: "\r", meta: { id: "\r" } },
      { type: "tag", content: "\n", meta: { id: "\n" } },
      { type: "text", content: "B" },
      { type: "tag", content: "\n", meta: { id: "\n" } },
      { type: "text", content: "C" },
      { type: "tag", content: "\r", meta: { id: "\r" } },
      { type: "text", content: "D" },
    ]);
    expect(tokens.filter((token) => token.type === "tag").map((token) => token.content)).toEqual([
      "\r",
      "\n",
      "\n",
      "\r",
    ]);
    expect(computeTagsSignature(tokens)).toBe(["\r", "\n", "\n", "\r"].join("|"));
  });

  it("keeps real CR and LF as plain text when tag policy is none", () => {
    const tokens = parseDisplayTextToTokens("A\r\nB\nC", { tagPolicy: "none" });

    expect(tokens).toEqual([{ type: "text", content: "A\r\nB\nC" }]);
    expect(computeTagsSignature(tokens)).toBe("");
  });
```

- [ ] **Step 3: Add editor marker round-trip tests**

In `packages/core/src/tag/index.test.ts`, add these tests inside `describe("Editor Tag Marker Conversion", ...)` after the existing `"serializes tokens to memoQ-style editor text"` test:

```ts
  it("serializes real CR and LF tags as standalone markers and parses them back", () => {
    const sourceWithLineBreaks = parseDisplayTextToTokens("A\r\nB\nC");

    expect(serializeTokensToEditorText(sourceWithLineBreaks, sourceWithLineBreaks)).toBe(
      "A{1}{2}B{3}C",
    );

    const parsed = parseEditorTextToTokens("X{1}{2}Y{3}Z", sourceWithLineBreaks);

    expect(serializeTokensToDisplayText(parsed)).toBe("X\r\nY\nZ");
    expect(parsed.filter((token) => token.type === "tag").map((token) => token.content)).toEqual([
      "\r",
      "\n",
      "\n",
    ]);
  });

  it("assigns separate marker numbers to repeated newline tags", () => {
    const sourceWithRepeatedLineFeeds = parseDisplayTextToTokens("A\nB\nC");

    expect(
      serializeTokensToEditorText(sourceWithRepeatedLineFeeds, sourceWithRepeatedLineFeeds),
    ).toBe("A{1}B{2}C");
  });
```

- [ ] **Step 4: Add duplicate newline QA test**

In `packages/core/src/qa/index.test.ts`, add this import below the existing model import:

```ts
import { computeTagsSignature, parseDisplayTextToTokens, parseEditorTextToTokens } from "../tag";
```

Then add this test inside `describe("Tag Integrity QA", ...)` after `"validates missing and extra tags correctly"`:

```ts
  it("treats a missing repeated protected newline tag as an error", () => {
    const sourceTokens = parseDisplayTextToTokens("A\nB\nC");
    const targetTokens = parseEditorTextToTokens("X{1}Y", sourceTokens);
    const segment = {
      ...buildSegment("A\nB\nC", ""),
      sourceTokens,
      targetTokens,
      tagsSignature: computeTagsSignature(sourceTokens),
    };

    const issues = validateSegmentTags(segment);

    expect(issues[0]).toMatchObject({
      ruleId: "tag-missing",
      severity: "error",
    });
  });
```

- [ ] **Step 5: Add MT prompt and retry test**

In `packages/localization/src/modules/MTModule.test.ts`, add this test near the existing single-unit translate tests, after `"translates through AITextTranslator and returns provider text as tokens"`:

```ts
  it('protects real newlines as markers in MT prompts and retries when one is dropped', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Newline Markers', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello\nworld\nagain' }, 0);
      const transport = createTransport();
      transport.createResponse
        .mockResolvedValueOnce({
          content: 'Bonjour{1}monde',
          status: 200,
          endpoint: '/mock',
        })
        .mockResolvedValueOnce({
          content: 'Bonjour{1}monde{2}encore',
          status: 200,
          endpoint: '/mock',
        });
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      const result = await module.translate({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(result.prompt.sourcePayload).toBe('Hello{1}world{2}again');
      expect(result.prompt.userPrompt).toContain('Hello{1}world{2}again');
      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('Bonjour\nmonde\nencore');
      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      expect(transport.createResponse.mock.calls[1]?.[0].userPrompt).toContain(
        'Previous translation was invalid.',
      );
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 6: Run tests to verify RED**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts packages/core/src/qa/index.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: FAIL. The core tag tests should show CR/LF remain plain text, repeated newline markers collapse or are not assigned, and the MT retry test should fail because the dropped second newline marker is not treated as an error.

## Task 2: Implement Default Newline Tokenization and Marker Numbering

**Files:**
- Modify: `packages/core/src/tag/TagCodec.ts`
- Modify: `packages/core/src/tag/TagMapper.ts`
- Test: `packages/core/src/tag/index.test.ts`

- [ ] **Step 1: Add occurrence-aware mapper helpers**

Replace the full contents of `packages/core/src/tag/TagMapper.ts` with:

```ts
import type { Token } from '../models';

const isOccurrenceScopedTagContent = (content: string): boolean =>
  content === '\r' || content === '\n';

export const getUniqueTagContents = (sourceTokens: Token[]): string[] => {
  const seen = new Set<string>();
  const markerContents: string[] = [];

  sourceTokens.forEach(token => {
    if (token.type !== 'tag') return;
    if (isOccurrenceScopedTagContent(token.content)) {
      markerContents.push(token.content);
      return;
    }
    if (seen.has(token.content)) return;
    seen.add(token.content);
    markerContents.push(token.content);
  });

  return markerContents;
};

export const createTagNumberMap = (sourceTokens: Token[]): Map<string, number> => {
  const markerContents = getUniqueTagContents(sourceTokens);
  const map = new Map<string, number>();

  markerContents.forEach((content, index) => {
    if (isOccurrenceScopedTagContent(content)) return;
    if (map.has(content)) return;
    map.set(content, index + 1);
  });

  return map;
};

export const createTagNumberResolver = (sourceTokens: Token[]): ((token: Token) => number | undefined) => {
  const tagNumberByContent = createTagNumberMap(sourceTokens);
  const occurrenceNumbersByContent = new Map<string, number[]>();
  const occurrenceCursorByContent = new Map<string, number>();

  getUniqueTagContents(sourceTokens).forEach((content, index) => {
    if (!isOccurrenceScopedTagContent(content)) return;
    const numbers = occurrenceNumbersByContent.get(content) ?? [];
    numbers.push(index + 1);
    occurrenceNumbersByContent.set(content, numbers);
  });

  return (token: Token): number | undefined => {
    if (token.type !== 'tag') return undefined;
    if (!isOccurrenceScopedTagContent(token.content)) {
      return tagNumberByContent.get(token.content);
    }

    const numbers = occurrenceNumbersByContent.get(token.content);
    if (!numbers || numbers.length === 0) return undefined;

    const cursor = occurrenceCursorByContent.get(token.content) ?? 0;
    const number = numbers[cursor];
    if (number === undefined) return undefined;

    occurrenceCursorByContent.set(token.content, cursor + 1);
    return number;
  };
};

export const getTagContentByMarkerIndex = (sourceTokens: Token[], markerNumber: number): string | undefined => {
  if (markerNumber < 1) return undefined;
  const markerContents = getUniqueTagContents(sourceTokens);
  return markerContents[markerNumber - 1];
};
```

- [ ] **Step 2: Use the resolver in editor serialization**

In `packages/core/src/tag/TagCodec.ts`, replace the `TagMapper` import with:

```ts
import { createTagNumberResolver, getTagContentByMarkerIndex, getUniqueTagContents } from './TagMapper';
```

Then replace `serializeTokensToEditorText` with:

```ts
export function serializeTokensToEditorText(tokens: Token[], sourceTokens: Token[]): string {
  const resolveTagNumber = createTagNumberResolver(sourceTokens);
  let fallbackTagNumber = getUniqueTagContents(sourceTokens).length + 1;

  return tokens
    .map(token => {
      if (token.type !== 'tag') return token.content;
      const tagNumber = resolveTagNumber(token) ?? fallbackTagNumber++;
      return formatTagAsMemoQMarker(token.content, tagNumber);
    })
    .join('');
}
```

- [ ] **Step 3: Add newline candidate helpers in the tokenizer**

In `packages/core/src/tag/TagCodec.ts`, add these helpers after `pushTextToken`:

```ts
const pushTagToken = (tokens: Token[], value: string): void => {
  tokens.push({
    type: 'tag',
    content: value,
    meta: { id: value },
  });
};

const findNextProtectedLineBreak = (
  text: string,
  startIndex: number,
): { value: string; index: number } | null => {
  for (let index = startIndex; index < text.length; index += 1) {
    const value = text[index];
    if (value === '\r' || value === '\n') {
      return { value, index };
    }
  }
  return null;
};
```

- [ ] **Step 4: Teach display parsing to split CR and LF**

In `packages/core/src/tag/TagCodec.ts`, update the fast path in `parseDisplayTextToTokens`:

```ts
  if (!hasCustomPatterns && !/[<{%\r\n]/.test(text)) {
    return [{ type: 'text', content: text }];
  }
```

Then replace the candidate selection loop in `parseDisplayTextToTokens` with this version:

```ts
  while (cursor < text.length) {
    let nextCandidate = findNextProtectedLineBreak(text, cursor);

    for (const pattern of patterns) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match || match[0].length === 0) continue;
      if (!nextCandidate || match.index < nextCandidate.index) {
        nextCandidate = { value: match[0], index: match.index };
      }
    }

    if (!nextCandidate) {
      pushTextToken(tokens, text.substring(cursor));
      break;
    }

    if (nextCandidate.index > cursor) {
      pushTextToken(tokens, text.substring(cursor, nextCandidate.index));
    }

    pushTagToken(tokens, nextCandidate.value);

    cursor = nextCandidate.index + nextCandidate.value.length;
  }
```

- [ ] **Step 5: Run core tag tests**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts
```

Expected: PASS for `packages/core/src/tag/index.test.ts`.

- [ ] **Step 6: Commit core newline marker serialization**

Run:

```bash
git add packages/core/src/tag/TagCodec.ts packages/core/src/tag/TagMapper.ts packages/core/src/tag/index.test.ts
git commit -m "feat: protect newlines as editor markers"
```

## Task 3: Make Duplicate Tag Counts Produce Errors

**Files:**
- Modify: `packages/core/src/qa/tagIntegrity.ts`
- Test: `packages/core/src/qa/index.test.ts`

- [ ] **Step 1: Replace tag count logic**

In `packages/core/src/qa/tagIntegrity.ts`, add these helpers after the options interface:

```ts
function countTags(tags: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  tags.forEach((tag) => {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  });
  return counts;
}

function getCountDelta(base: Map<string, number>, comparison: Map<string, number>): string[] {
  const delta: string[] = [];
  base.forEach((count, tag) => {
    const missingCount = count - (comparison.get(tag) ?? 0);
    for (let index = 0; index < missingCount; index += 1) {
      delta.push(tag);
    }
  });
  return delta;
}

function formatTagForMessage(tag: string): string {
  if (tag === '\r') return '\\r';
  if (tag === '\n') return '\\n';
  return tag;
}

function formatUniqueTags(tags: string[]): string {
  return [...new Set(tags)].map(formatTagForMessage).join(', ');
}
```

Then replace the `missing` and `extra` calculations in `validateTagIntegrityTokens` with:

```ts
  const sourceTagCounts = countTags(sourceTags);
  const targetTagCounts = countTags(targetTags);

  const missing = getCountDelta(sourceTagCounts, targetTagCounts);
  if (missing.length > 0) {
    issues.push({
      ruleId: 'tag-missing',
      severity: 'error',
      message: `Missing tags: ${formatUniqueTags(missing)}`,
    });
  }

  const extra = getCountDelta(targetTagCounts, sourceTagCounts);
  if (extra.length > 0) {
    issues.push({
      ruleId: 'tag-extra',
      severity: 'error',
      message: `Extra tags found: ${formatUniqueTags(extra)}`,
    });
  }
```

- [ ] **Step 2: Run QA tests**

Run:

```bash
npx vitest run packages/core/src/qa/index.test.ts packages/core/src/TagValidator.test.ts
```

Expected: PASS for both QA suites. The new repeated newline case should now produce a `tag-missing` error.

- [ ] **Step 3: Commit duplicate tag count validation**

Run:

```bash
git add packages/core/src/qa/tagIntegrity.ts packages/core/src/qa/index.test.ts
git commit -m "fix: validate repeated protected tag counts"
```

## Task 4: Verify MT Integration

**Files:**
- Test: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Run MT module tests**

Run:

```bash
npx vitest run packages/localization/src/modules/MTModule.test.ts
```

Expected: PASS. The new MT test should show `sourcePayload` as `Hello{1}world{2}again`, the first provider response should trigger retry, and the second response should parse back to real newlines.

- [ ] **Step 2: Commit MT integration coverage**

Run:

```bash
git add packages/localization/src/modules/MTModule.test.ts
git commit -m "test: cover newline marker MT retry"
```

## Task 5: Final Targeted Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the full targeted test set**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts packages/core/src/qa/index.test.ts packages/core/src/TagValidator.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: PASS for all targeted suites.

- [ ] **Step 2: Run package builds**

Run:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/localization
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: clean worktree if all task commits were made, or only intentionally uncommitted verification notes if an earlier command failed and required investigation.
