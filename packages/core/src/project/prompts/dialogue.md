## intro-line

```text
Translate the following dialogue segments from {{srcLang}} to {{tgtLang}}.
```

## json-contract-intro

```text
Return strict JSON only with this schema:
```

## json-contract-schema

```text
{"translations":[{"id":"<segment-id>","text":"<translated-text>"}]}
```

## preserve-id-line

```text
Each output item must preserve its source id exactly.
```

## no-omit-ids-line

```text
Never omit or add IDs.
```

## segments-header

```text
Dialogue Segments:
```

## segment-index-line

```text
{{index}}. id: {{id}}
```

## segment-speaker-line

```text
   speaker: {{speaker}}
```

## segment-source-label

```text
   source:
```

## tm-header

```text
   TM Reference (best match):
```

## tm-entry-summary

```text
   - Similarity: {{similarity}}% | TM: {{tmName}}
```

## tm-entry-source

```text
   - Source: {{sourceText}}
```

## tm-entry-target

```text
   - Target: {{targetText}}
```

## tb-header

```text
   Terminology References (hit terms):
```

## tb-entry

```text
   - {{srcTerm}} => {{tgtTerm}}{{noteSuffix}}
```

## previous-group-header

```text
Previous Dialogue Group (for consistency):
```

## previous-group-speaker-line

```text
speaker: {{speaker}}
```

## previous-group-source-label

```text
source:
```

## previous-group-target-label

```text
target:
```

## validation-feedback-header

```text
Validation feedback from previous attempt:
```
