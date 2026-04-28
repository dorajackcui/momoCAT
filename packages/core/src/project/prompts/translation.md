## system-base-rules

```text
From {{srcLang}} to {{tgtLang}}. Output in {{tgtLang}} ONLY.
Keep all protected markers exactly as they appear, including forms such as {1>, <2}, {3}
Preserve all escape sequences exactly as they appear, including \n and \r.
Return only the translated text, without quotes or extra commentary
```

## source-header-plain

```text
Source ({{srcLang}}):
```

## source-header-protected

```text
Source ({{srcLang}}, protected-marker format):
```

## context-line

```text
Context: {{context}}
```

## current-translation-label

```text
Current Translation:
```

## refinement-instruction-label

```text
Refinement Instruction:
```

## tm-header

```text
TM References (top matches):
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

## validation-feedback-header

```text
Validation feedback from previous attempt:
```
