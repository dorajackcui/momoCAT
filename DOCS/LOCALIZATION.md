# Localization engine

## Scope

This document owns the durable contracts for tokens/tags, MT request planning, TM/TB references, Runtime TM, and desktop resource behavior.

Ownership by package:

- `@cat/core`: pure tokens, tag/protected-marker transforms, text normalization/hashes, QA, prompt builders, strict response parsing, and shared contracts.
- `@cat/db`: persistent TM/TB/project repositories and FTS recall primitives.
- `@cat/localization`: file/unit orchestration, request modes, jobs, modules, provider transport, Runtime TM, inspect, and artifacts.
- `apps/desktop`: project editing, Working/Main TM lifecycle, repeated-segment behavior, resource UI, and external-file sync.
- `apps/cli`: syntax and terminal behavior only.

Stable facades keep cross-layer callers independent of maintenance-oriented splits:

| Boundary                     | Stable entrypoint                      | Internal collaborators                                                                                                 |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Term matching                | `@cat/core/text` and `termMatching.ts` | normalization, search planning, and English inflection helpers                                                         |
| Persistent TM matching       | desktop `TMService`                    | shared scoring and result-selection collaborators in `@cat/localization`; diagnostic traces still call the facade      |
| Persistent TM storage/recall | `CATDatabase` / `TMRepo`               | [Repository ownership](DATA_MODEL.md#repository-ownership) maps entry/index, fuzzy/concordance, and sync collaborators |
| MT prompt/response handling  | `MTModule`                             | prompt-parameter construction and batch-response processing                                                            |
| Engine orchestration         | `LocalizationEngine`                   | assembly, unit preparation, resume fingerprinting, and option helpers                                                  |

Callers should use the stable entrypoint rather than importing these collaborators as alternate public APIs.

## Token and tag contract

Segments store source and target as `Token[]`, not as display strings. Tags can be paired starts/ends or standalone tokens; tag metadata and order are part of translation correctness.

Three text forms must remain distinct:

| Form                 | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Display text         | User-facing tag/placeholder representation.                                          |
| Editor text          | Editable representation whose markers can map back to source tag tokens.             |
| Protected MT payload | Numbered markers such as paired `{1>…<2}` and standalone `{3}` sent through prompts. |

The MT module boundary (`MTModule` and its batch-response collaborator) is the only localization layer that interprets provider output as editor-marker text. It parses the response back to tokens before request-mode strategies produce display-text `UnitResult.target` values. QA does not accept, reject, or repair provider output.

A consumer persisting a `UnitResult.target` into a token store must use `parseDisplayTextToTokens()` (or preserve returned tokens if the API grows that field). Running `parseEditorTextToTokens()` a second time can reinterpret literal placeholder-like text and corrupt tag identity.

File tag policy is resolved at import/planning time:

- `default`: marker-like text may become CAT tag tokens.
- `none`: marker-like text remains ordinary text.

Desktop imports persist this policy in file import options and reuse it for token parsing and QA. Changing the policy for an already-tokenized file requires re-import rather than silently reparsing stored content.

Under `default`, angle tags recognize `❮` and `❰` as alternatives to `<`, and `❯` and `❱` as alternatives to `>`, including mixed delimiters. Token content, identity, and display/export text retain the original characters; editor/MT markers use the ASCII forms `{1>`, `<2}`, and `{3}`. Empty or incomplete angle tags remain text, and `none` disables this recognition. Files imported with plain-text or truncated tags require re-import after recognition changes.

Angle scanning uses a stack of attribute quotes: opening angles inside attributes start embedded spans, whose quotes are independent of their parent. An outer tag such as `❮g equiv-text="❰cf Color="#112233"❱"❯` is one protected tag and maps to `{1>`; `❮/g❯` maps to `<2}` and pairs by the outer name `g`. Spans and attribute quotes must close completely. An incomplete quoted or embedded span ends the angle scan without retrying its contents; unmatched opening angles in quoted prose are not guessed to be literal content. Outside attributes, a new outer opener starts a new candidate, leaving the unfinished prefix as text. Scanning only moves forward, and each parse reuses its next angle and line-break-escape matches across other tag rules. Classification and pairing ignore attributes and skip self-closing tags. Display and editor parsing share these recognition rules. Copying, cloning, or extending the exported default regex list preserves its built-in angle-scanner rule; other custom regexes retain their explicit matching behavior.

## MT request planning

Application defaults and option syntax are owned by [CLI](CLI.md#inspect-localization) and [Desktop](DESKTOP.md#files-and-background-jobs).

| Mode             | Contract                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `window`         | Dense ordered windows; every eligible current unit becomes a requested row.                                                                |
| `window-partial` | Physical scan windows remain stable, but only units requiring target text receive response ids. Existing targets can be read-only context. |

Window requests use one to five current units, stay ordered and sequential within a file, and write results through per-unit persistence surfaces.

Target baseline is resolved before planning:

- `use-current-targets`: preserve existing target cells; partial mode requests eligible blanks and can use existing targets as context.
- `ignore-current-targets`: clear eligible, non-confirmed current targets before planning so they can be regenerated.

Legacy `targetScope` belongs to single-unit concurrent translation and is not interpreted by window planners.

For a selected segment scope, rows form a contiguous context sequence in original file order for `window-partial`: excluded rows do not enter its scan windows or neighboring context. Results retain their original segment IDs and are written back only to those segments. Progress counts the selected scope, and existing-target baseline and confirmed-row locking rules still apply. Empty scopes and IDs outside the current file are rejected. [Desktop](DESKTOP.md#files-and-background-jobs) owns the UI selection behavior.

### Partial-window prompt order

```text
batch instruction
read-only context rows
requested rows with per-row references
strict response format
```

Read-only rows have no response id, no per-row TM/TB blocks, and must not appear in the provider response. Requested rows receive source payload, optional context, TM, concordance, and TB references.

Provider ids identify response rows only. Runtime correlation remains document-qualified by unit identity; never match results by array position.

## Strict response and repair

The provider response shape is:

```json
{ "translations": [{ "id": "<id>", "text": "<target text>" }] }
```

Only the `translations` field is allowed. Every requested id must appear exactly once; extra, missing, or duplicate ids and unexpected fields are validation failures. Array order is irrelevant.

Two recovery layers have different jobs:

- The MT module response processor parses and validates the batch contract. Malformed JSON and missing/extra/duplicate ids fail the request. Tag differences are QA findings and do not cause rejection, repair requests, or retries.
- `TranslationJobRunner` owns task attempts and retries, including batch parsing failures that escape the MT boundary, and resumable execution.

Do not turn progress events or diagnostic artifacts into retry/resume truth.

## TM matching and prompt selection

Mounted persistent TMs are resolved by project. Matching uses normalized source text while preserving tag-aware hashes/signatures:

- exact candidates use source hash/tag structure;
- fuzzy recall adds similarity candidates;
- source-side concordance adds bounded local-overlap evidence;
- final scoring/classification/diversity prevents near-duplicate prompt flooding.

For one persistent prompt row, selection is capped at:

- **3 TM references** (exact/fuzzy, similarity ordered);
- **7 concordance references**;
- **10 total persistent references** before Runtime TM merging.

Explicit Concordance Search is a separate desktop route from the active TM-match flow. Confirm which route is wrong before changing recall SQL or scoring.

The desktop CAT panel keeps TM/TB application behavior unchanged while comparing the selected TM source with the active segment source. Removed TM text and added current text are highlighted separately, and tag tokens remain atomic; TB rows do not drive the source comparison.

### Language profiles

Default/CJK behavior uses the established normalization, scoring, concordance, diversity, and cap rules.

English TM recall adds bounded conservative variants for regular singular/plural forms, hyphen/space forms, and dotted acronyms. Variants only widen candidates; final evidence gates still decide emission. Canonical scoring handles cases such as dotted acronyms and regular plurals while rejecting one-sided short-acronym collisions. Multi-word concordance requires phrase-level evidence; one ordinary token or stopword overlap is insufficient.

## TB matching

Mounted TBs are queried for source terms, and selected terms become structured per-request references.

Default/CJK matching uses strict normalized term matching. The English overlay supports conservative regular singular/plural, possessive, hyphen/space, and uppercase dotted-acronym equivalents. It does not use general stemming or fuzzy edit distance.

Read-only partial-window context rows do not receive TB blocks.

## Quality assurance

[`evaluateDocumentQa`](../packages/core/src/qa/documentQa.ts) owns pure document checks. [`runQA`](../packages/localization/src/qa/runQA.ts) resolves mounted terminology and invokes the same engine for Desktop and CLI. Repeated sources share terminology lookups. Desktop runs whole-file loading, checks, and persistence in a worker; editor filters never limit check scope. CLI reports findings without changing the project's saved QA results.

The eleven categories are empty targets, terminology, same source/different targets, same target/different sources, substring consistency, tags/placeholders, line breaks, numbers, URLs, Chinese in target, and target text. [QA settings](../packages/core/src/project/qaSettings.ts) owns defaults and options. Reverse consistency, substring checks, Chinese detection, and ordinary tag order default off. Basic optional checks follow their category switch; only tag order and target-text subchecks have independent switches. Protected-token checks always run within QA, independently of those switches; findings are advisory.

Terminology combines mounted TB matches and optional square/corner-bracket term pairs. Historical terms take precedence; conflicting marked pairs are reported without replacing the baseline. Findings group by term pair. Consistency normalizes whole surrounding quotes/brackets, retaining internal text. Substring checks use unique reference translations, configurable minimum letter counts, and locatable reference rows. Numbers and URLs compare occurrences without enforcing order. Target text checks punctuation, spaces, width mixing, and paired symbols.

### Shared tag rules

[`tagRules.ts`](../packages/core/src/qa/tagRules.ts) owns missing, extra, occurrence-count, closing/nesting, and order comparisons. These rules only produce findings; no QA finding blocks an operation or triggers an AI request.

| File import mode                    | QA behavior                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Protect CAT markers** (`default`) | [`checkProtectedTokens`](../packages/core/src/qa/protectedTokens.ts) compares tokenizer-generated tag tokens. These checks always run when QA runs and ignore optional tag types/ignore lists. |
| **Plain marker-like text** (`none`) | Configurable **Standard tags** scans angle/color/brace/literal-newline text and optional tag order.                                                                                            |

One project may contain both file modes. The legacy project `tagMode` is accepted at the input boundary and removed by normalization. Literal text is never promoted to a protected token just because it resembles `{1}`. Editor markers are display representations of tokens.

Comparisons preserve original token content and occurrences, including Unicode angle tags, printf placeholders, and protected newline escapes. Actual line breaks belong to the line-break check. Invalid source nesting is not used as a structural baseline. Protected-token checks omit pure order differences; Plain tag order remains optional.

Findings use `info`. The public `TagValidator` retains legacy display severities as a compatibility adapter, but business workflows do not import it. The former `blocking` field and predicate have been removed. `FileQaReport` reports required `issueCount` (findings) and `affectedSegments` (distinct rows with findings); the obsolete `errorCount`/`warningCount` fields have been removed from both Desktop and CLI reports.

New settings accept only independently optional checks in `disabledCheckIds`; normalization still drops obsolete IDs when reading legacy settings. All persisted-file QA entrypoints use the same import-policy parser. Missing options/policy retain the legacy Protect default; malformed JSON, non-object options, or an unsupported policy fail with the file ID and a clear reason, without replacing saved findings or silently switching modes.

### QA entrypoints

| Entry                                                      | Behavior                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop QA / CLI `qa`                                      | Run whole-file checks including cross-row consistency and learned terminology. Desktop persists results; CLI only reports them.                                                                             |
| Editor Instant QA                                          | After successful single/selected confirmation, optionally run single-row QA through [`runProjectSegmentQA`](../packages/localization/src/qa/runProjectSegmentQA.ts). Results update feedback independently. |
| Confirm, TM commit/application, repeat propagation, export | Do not consult QA. Existing findings never block, skip rows, or roll back these operations. Export has no QA override/force branch.                                                                         |
| AI Translate / Refine / Window / Dialogue                  | Parse provider output without tag QA acceptance or repair. QA never causes another provider request or a failed translation batch.                                                                          |

CLI QA returns success when checking completes, including when findings exist. The former `--fail-on-issues` option is removed. CLI translation still reports execution failures through `summary.failed` and preserves partial output. It does not run whole-file QA before writing output. Inspect prepares matches and prompts only. [CLI](CLI.md) owns command syntax.

### QA result lifecycle and legacy consumers

Panel、行内提示、文件问题数统一读取各行 `qaIssues` / `qaIssuesJson`。Panel 不再另存一份 `report.issues`。数据库 `NULL` 表示没有当前结果，`[]` 表示这次检查没有发现问题；即时检查仅覆盖当前行，不能作为整文件已检查的证明。

- [`runProjectFileQA`](../packages/localization/src/qa/runProjectFileQA.ts) 原子替换整文件行结果；即时检查写入同一来源，将已有 findings 与新单行结果按问题身份合并，无手写规则 ID 保留清单。单行检查不能替换跨行证据；旧问题由手动整文件重查移除。
- 目标内容和状态变更均保留上次 QA 结果与问题数，保存和重新打开文件也不清除。编辑、AI、TM/TB 应用、重复传播共用此规则；编辑本身不会触发 QA。Confirm 后仍可按项目开关执行即时检查。
- QA 设置变化清除该项目结果；术语新增、修改、清空、删除、挂载或取消挂载清除受影响项目结果。编辑器接收配置/术语失效事件，统一清除行内和 Panel 结果。不会自动启动整文件检查。
- 异步 QA 在持久化前使用 immediate 事务核对数据库变动版本，包含其他连接的术语修改；期间有写入时先返回 `stale`，不再全量读取行，也不写旧结果。整文件 QA 的原始内容及设置快照在事务外生成；版本未变时仍在事务内复核输入，保留未提供版本的宿主的内容检查。编辑器还校验本地修改，防止尚未保存的编辑被旧结果覆盖。
- 修改后的 QA 筛选行集合和旧 findings 保持稳定，用户可以继续修订；当前会话中 Panel 提示需要重查。退出筛选清空全部筛选，不恢复原条件。

无消费者的 tag 插入/删除/空排序自动修复已移除，编辑器不再生成或携带 `autoFixSuggestions`。公开类型、`TagValidator.suggestions` 空数组和 deprecated `generateAutoFix()`（返回 `null`）只作为兼容边界。编辑器“插入源文 tag”是用户发起的文本编辑，与旧自动修复无关。

QA 筛选只有 `qa_issue`；旧 `qa_error` / `qa_warning` 在存储读取边界迁移，搜索缓存与过滤算法不再计算旧严重度分支。公开 `validateSegmentTags` / `validateSegmentTerminology` 和旧 severity 字段仍保留兼容；保存错误是独立写入反馈。

### Confirm and instant QA

Confirmation owns saving, status changes, Working TM updates, and repeat propagation. It has no dependency on QA results. Editor composition starts optional Instant QA after the save succeeds and does not await it; selection actions and navigation finish independently. A check failure shows an independent QA message, never a save error or a rollback. Late results are discarded after content, resource, or file changes.

When Instant QA is enabled, the check includes fixed token checks and enabled single-row checks (empty targets, line breaks, numbers, URLs, Chinese, target text, Plain tags, and mounted TB terminology). Marked pairs are checked against mounted TB terms and repeated pairs in the same row, even when the expected translation appears elsewhere in the target. It does not learn marked terminology or recalculate cross-row consistency. Mark-count checks remain document-only because missing-pair decisions may depend on terms learned from other rows. When disabled, the follow-up returns without checking or writing results, including token findings. Manual whole-file QA remains available.

### AI response handling

Single-row Translate/Refine makes one provider request per invocation and parses the returned marker text. Window/Window-partial parses the strict JSON/ID contract and returns all rows; there is no tag repair request. Dialogue retains response-contract retries, including malformed JSON/IDs, but does not inspect QA findings. Transport, parsing, and persistence failures remain execution failures, and the job runner retains its task retry/resume policy.

Tag repair prompts, injected QA validators, and tag repair audit events have no business consumers and are removed. Prompt instructions to preserve markers and the tokenizer's source-token mapping remain part of translation representation.

### QAtools comparison

对照基准为 [QAtools 0.1.8 / 5ed8410](https://github.com/dorajackcui/QAtools/tree/5ed84103f3936473cf519b9c23f7acb154d10808) 的“一键质量检查”，以该版本实际代码与运行结果为准。**11 个检查大类均已具备，但检查结果并不严格等价。** 下表及差异样例用于判断覆盖范围；“覆盖样例一致”不代表所有边界等价，也不要求两边报告措辞、条数或分组结构相同。

| 检查项                | 当前能力与对照结果                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 空译文                | 内容规则一致；QAtools 固定执行，momoCAT 可开关、默认开。                                                                                   |
| 术语                  | 支持 `【】`、`[]`，兼容 `［］`；按出现顺序配对；挂载 TB 与 marker 学习术语一起检查。边界差异见下表。                                       |
| 同 source 不同 target | 空译文算一个译文变体；去除整串外层引号/括号，保留内部文本及大小写。覆盖样例一致。                                                          |
| 同 target 不同 source | 忽略空 target，默认关闭。覆盖样例一致。                                                                                                    |
| 子串译文一致性        | 使用唯一非空参考译文、边界和最短字母数；排除已检查术语及纯 printf 占位符参考译文，可定位参考行。默认关闭。                                 |
| Tag / Placeholder     | Plain 文件支持 angle/color/brace/literal newline、数量、闭合/嵌套及可选顺序；Protect 文件使用固定 token 检查。高级过滤配置不等价，见下文。 |
| 换行数量              | CRLF 按一个换行；真实换行与字面 `\n` 分开。覆盖样例一致。                                                                                  |
| 数字一致性            | 比较重复出现次数；支持千分位分隔、千分号、编码字符排除及破折号归一化。覆盖样例一致。                                                       |
| URL 一致性            | 支持单引号、中文包围符、尾标点与起始单词边界。覆盖样例一致。                                                                               |
| Target 中文           | 覆盖样例一致；QAtools 默认开，momoCAT 默认关。                                                                                             |
| Target 文本规范       | 包括混合重复标点、连续/首尾空格、同类全半角标点混用及括号引号配对。覆盖样例一致。                                                          |

**Marker 与挂载 TB 的组合：** 两者可以同时启用。TB 优先，marker 配对用于学习当前文件中的新术语；学习完成后回扫全文件，包括学习行之前和之后的未标记行。学到的术语只用于本次检查，不写入 TB。这与 QAtools 的基本流程一致，但冲突处理和匹配边界存在以下六种已知差异：

| 情况                                                                                     | QAtools 实际结果                                               | momoCAT 当前结果                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| TB 有 `Open → 打开`；同一行 `[Open] [Save] → [开启] [存档]`，随后 `Save file → 保存文件` | 保留 TB 的 Open 标准，仍学习 `Save → 存档`，因此后行也报问题。 | 标记行发生冲突，整行新增映射不作为后续基准，后行不报此问题。 |
| 没有词库时 `Open → [打开]`，只有 target 带 marker                                        | 报标记数量不一致。                                             | 不单独报告 target 多余 marker。                              |
| 学到 `Save → 保存` 与 `Save file → 存档`，随后 `Save file → 存档`                        | 优先最长非重叠术语，不要求短词 Save 的译法。                   | 文内学到的长短术语都检查，报告缺少“保存”。                   |
| 学到 `city → 城市`，后行 `cities → 城镇`                                                 | 识别复数，报告译法问题。                                       | 文内学到的词没有英文复数扩展，此处不命中。                   |
| 学到 `city → city`，后行 `city → cities`                                                 | 允许 target 复数，不报。                                       | target 要求原词命中，报译法问题。                            |
| 学到 `Open file → 打开文件`，后行 source 为字面 `Open\nfile`                             | 将字面转义空白归一化，能命中并检查译法。                       | 不将字面转义换成空格，该词未命中。                           |

前两项与上游 README 的部分描述不同，应以固定版本的实际行为为准。上述差异是当前行为记录，不代表已经对齐。

其他配置和匹配差异：

- 挂载 TB 复用 CAT 的语言匹配和项目 TB 优先级；QAtools 使用自己的忽略大小写、ASCII 边界和复数匹配器。因此同为术语检查，不代表各语言、边界和重叠情况下都得到相同结果。
- QAtools angle tag 的 JSON `patterns` 是正则**纳入**过滤；momoCAT 是完整 tag 字符串的**忽略**清单，二者不能直接互换。
- QAtools 术语引擎支持正则排除配置；当前项目 QA settings 没有对应的自定义正则项。
- 对照时应统一 Chinese、空译文、tag 顺序与类型、术语 marker 和子串阈值；普通文本兼容样例使用 Plain 导入（`tagPolicy: none`）及 Standard tags 配置。Protect 文件使用 tokenizer 的固定完整性检查。

相关行为测试：[`内容兼容样例`](../packages/core/src/qa/documentQa.compatibility.test.ts)、[`marker + 挂载 TB / CLI 集成`](../packages/localization/src/cli/qaFileCommand.test.ts)、[`多选确认`](../apps/desktop/src/renderer/src/hooks/editor/useSelectedSegmentActions.test.ts)、[`AI 批次修复`](../packages/localization/src/modules/MTModule.test.ts)。

## Source terminology precheck

Source terminology precheck is a provider-backed, read-only workflow that discovers source-language term candidates not already covered by the project's mounted TB matches. The reusable extractor belongs to `@cat/localization`; desktop file handling is its first application adapter, and future CLI surfaces must delegate to the same contract instead of recreating extraction logic.

The extractor accepts document-qualified units with source text and per-unit historical terms. Equivalent source rows may share one provider request, but results are mapped back to every original unit identity. Provider requests contain at most ten unique source rows and may be split earlier by prompt-size budget. Independent batches use the shared bounded scheduler and honor `maxConcurrency`. Strict responses return every opaque request id exactly once and contain source terms only—no target suggestions, translations, classifications, or prose. Malformed or contract-invalid responses may receive bounded repair feedback; provider transport and authentication failures fail that batch immediately instead of being resent as validation feedback.

Provider candidates are treated as untrusted. Extraction is deliberately precision-first: the prompt rejects ordinary vocabulary, descriptive phrases, and incidental concepts, says that an empty result is normal, forbids forced extraction, and allows the complete segment when it is itself one glossary-worthy unit. Capitalization, repetition, and phrase shape are explicitly insufficient on their own; glossary value is a semantic model decision based on localization consistency risk, not a language-specific word list or casing heuristic. Local validation remains deterministic: a candidate must be an exact substring of its source unit, is normalized and deduplicated, and is removed when the existing language-aware TB rules consider it covered by a historical term. Batch failures stay scoped to their units. Global aggregation preserves the first source spelling, records other surface variants, occurrence counts, document/unit identities, row numbers, and bounded source examples.

The desktop Settings dialog exposes the selection-policy portion of this prompt as an app-wide named-prompt library. The current precision-first policy remains a read-only built-in default; users can create, rename, edit, activate, and delete multiple custom policies, while activating the Default card preserves the saved library. A legacy single custom policy is surfaced as a named prompt and migrates into the library on the next mutation. Invalid catalog data falls back to the valid entries or Default and surfaces a recovery warning before the next mutation replaces the invalid stored value. Source language, source rows, historical terms, prompt-injection protection, exact-substring/source-only requirements, strict response shape, id correlation, and validation-repair feedback remain application-owned and cannot be replaced by a customization. Each extraction job reads the active prompt in one settings snapshot when it starts, and prompt-size batching includes that policy.

The desktop `TM/TB` action offers source-term extraction alongside the existing TM/TB reference export. Reference export preserves the retained source sheet, overlays its target column from the file's current stored segments (including cleared targets), and appends the per-row TM/TB reference columns. Precheck runs in a worker, uses the project's configured provider, and writes an output workbook containing per-row historical TB/source candidates plus a `New_Terms` summary sheet. Cancellation is cooperative: no new lookup or provider batch starts after the request is observed, in-flight provider responses may finish, and their completed candidates are preserved in a partial workbook while untouched rows are marked `cancelled`. When the retained source workbook exists, the output preserves its first sheet; when that workbook is unavailable, desktop reconstructs a temporary source-only sheet from the file's stored segments and removes the temporary file after the worker finishes. Valid UTF-8 CSV source text is decoded explicitly so non-Latin content survives this fallback unchanged, while other encodings retain the existing binary parser path. It does not translate terms, update a TB, modify project segments, or feed candidates into AI translation. Those are separate future workflows.

## Runtime TM

Runtime TM is an isolated in-memory SQLite TM for one shared translation job. It reuses the normal repository/service/module recall path and is discarded when the job ends.

For translation projects, it is enabled for `LocalizationEngine.translateFile()` and `translateProjectSegments()` with `window` or `window-partial`, including the desktop adapter over the shared project-segment job. It is not used by review/custom projects, inspect, legacy concurrent `translateUnits()`, or legacy desktop translation workflows.

Eligible non-empty `translated` and `skipped` results are appended after their task results have been persisted. On resume, compatible checkpoint results rebuild Runtime TM before new requests continue.

Runtime references merge into the existing TM/concordance blocks, never a separate prompt section. Selection has independent slots:

| Source                |  TM | Concordance |
| --------------------- | --: | ----------: |
| Persistent TMs        |   3 |           7 |
| Runtime TM            |   3 |           7 |
| Maximum merged prompt |   6 |          14 |

Runtime matches duplicating a selected persistent match with the same source hash and target text are removed. The merged maximum is therefore 20 references, often fewer.

Runtime TM never writes Working TM, Main TM, or the persistent project database and never appears as a user-managed resource.

## Desktop Working TM and repeated segments

Every translation project has a mounted read/write Working TM. Confirming a translation segment normally updates that TM inside the same transaction as the segment/file state. Review and custom project types do not perform this commit.

AI translation, refinement, and manual target edits write `draft` (or `empty` for an empty result) regardless of project type. These unconfirmed writes stay local and do not query repeat groups. Job/checkpoint result labels such as `translated`, `reused`, and `failed` describe execution outcomes and are separate from segment workflow status.

The Files tab `Commit` action can write a whole file to either its writable Working TM or a mounted Main TM. It defaults to confirmed segments; `All with translations` also includes other statuses when both source and target are non-empty. Every segment written by the action is left confirmed; excluded rows remain unchanged. This action disables repeat propagation so each row keeps the translation being committed. Segment confirmations, entry writes, and FTS updates for the file run in one transaction, so a failed commit leaves both segment state and the target TM unchanged. A Working TM target must be the writable Working TM mounted to that file's translation project, and review/custom projects cannot use this route to populate a Working TM.

The Project Translation Memory tab keeps Working TM management intentionally narrow: users can export its source/target rows to XLSX or reset all entries after confirmation. Export reads one stable database snapshot and serializes the workbook in a background worker, writing the stored source/target content and original tag text into two visible columns. Reset runs in a background worker and atomically removes the current entries plus their FTS rows, then reloads the pane and publishes a project-wide `working-tm-reset` invalidation. The TM resource, project mount, project files, and translated segments are preserved.

Same-source repeats are scoped to the current file in translation projects:

- confirming the first occurrence copies its target to every later same-source occurrence and confirms them, including existing confirmed or independently edited targets;
- changing the first occurrence to Draft does not propagate; confirming it again synchronizes all later occurrences again;
- editing or confirming a later occurrence changes only that occurrence, and the next confirmation of the first occurrence overwrites that local variation;
- already confirmed occurrences with identical target tokens need no write;
- confirmation uses one same-source query and file order to find the first occurrence, with no persisted follow/detach state or AI-specific exceptions.

The editor marks every occurrence in a same-source repeat group. The first occurrence uses the same repeat icon with a small superscript `1`; later occurrences use the plain repeat icon. The `First repetition` filter isolates those first occurrences.

Post-commit `working-tm-updated` and segment events refresh match/reference state. Whole-file commits to Working TM publish a project-scoped `working-tm-updated` invalidation after the write succeeds. Batch workflows that deliberately should not pollute Working TM pass `commitToWorkingTM: false` while preserving their own propagation/event behavior.

## Persistent resource import and sync

Import is a one-time addition/overwrite operation. Sync creates a durable link to a local spreadsheet and exposes the linked file in desktop resource UI.

The desktop management cards can rename TM/TB metadata in place. Renaming preserves the resource id, language pair, entries, project mounts, external-file sync binding, and `updatedAt`; resource-list order and equal-priority mount order therefore remain stable.

All four write paths (TM import, TM sync, TB import, TB sync) treat a file as a key-to-entry mapping with last-wins semantics: rows sharing a conflict key (TM `srcHash`, TB `srcNorm`) collapse to the final occurrence, and duplicates count as skipped. TM import streams the file in one pass, tracking this run's writes per `srcHash` so a later duplicate rewrites the same entry in place; TB paths reduce in memory (`dedupeRowsLastWins`); TM sync reduces via `INSERT OR REPLACE` staging. `ON CONFLICT` clauses therefore express only file-vs-database policy: import `overwrite` replaces existing DB entries, otherwise they win.

Project resource pickers offer only unmounted TMs and TBs whose directed source/target language pair exactly matches the project.

### TB sync

TB sync parses the entire linked workbook before mutation, then mirrors valid rows by clearing and rewriting the TB in one transaction. A read/parse/insert failure rolls back instead of leaving a partial TB. Sync records its latest outcome in `app_settings` and publishes reference invalidation after success.

### TM sync

TM sync is incremental and worker-only for large-file safety:

1. Parse the first sheet and stage valid normalized rows in `tm_sync_staging` by sync run.
2. Diff staged rows against existing entries in SQL.
3. Apply additions, changes, and deletions in bounded transactions.
4. Maintain base rows and FTS rows together, then clean staging.

TM sync strictly mirrors the valid deduplicated rows in the linked file: entries missing from the file are removed, including local edits or entries committed through other workflows. A header-based file containing only its reviewed header row therefore clears the TM. The completed or partial report counts only overwritten/deleted local edits whose apply transaction completed. Cancellation can leave a consistent applied prefix; rerunning converges, and only a full success advances the conflict baseline.

Source/target columns must be distinct nonnegative indexes at the main-process trust boundary. Saving a binding persists the reviewed column positions and, for header-based files, the selected header text. Every sync revalidates that identity before staging or entry mutation; a legacy binding without identity, changed header/position, missing selected header, or invalid configuration requires mapping review instead of risking a whole-TM rewrite. Headerless files have no semantic header identity, so both reviewed positions must contain observable values and the user must review the mapping before every strict sync. That one-use review authorization is process-local and expires when the sync starts or the app restarts; this prevents a semantic column move from being accepted merely because the old numeric positions still contain data. Changing the file, positions, header mode, or header identity starts fresh sync history; re-saving the exact reviewed binding preserves it. Legacy deletion-policy fields no longer affect behavior and are removed on the next config or outcome write.

Same-TM delete, import, file commit, mapping update, and sync operations are mutually exclusive in the desktop service so another writer cannot invalidate a successful strict-mirror result. Different TMs may sync independently and isolate their staging cleanup.

## Inspect, audit, artifacts, and resume

- Inspect composes prompt/reference artifacts without provider requests.
- Checkpoint JSONL is the only resume truth.
- Event JSONL is a lightweight progress stream.
- Snapshot output is throttled partial user output.
- Audit JSONL records request/repair/persist/Runtime-TM events without full text.
- Full artifacts are opt-in prompt/TM/TB diagnostics and may contain private content.

Inspect and translate should use the same request mode, baseline, and tag policy during diagnosis. Secrets must never be serialized into any of these outputs.

Provider HTTP failures report the numeric status and a local standard status label. Untrusted response bodies and status text are excluded from transport errors, including malformed JSON responses, because errors can flow into checkpoints, events, audit, and terminal output.

## Key entrypoints

| Concern                               | Source                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token/tag helpers                     | [`packages/core/src/tag`](../packages/core/src/tag)                                                                                                                                                                                                                 |
| Prompt and strict response contracts  | [`packages/core/src/project`](../packages/core/src/project)                                                                                                                                                                                                         |
| Localization engine facade            | [`packages/localization/src/LocalizationEngine.ts`](../packages/localization/src/LocalizationEngine.ts)                                                                                                                                                             |
| Engine orchestration collaborators    | [`packages/localization/src/engine`](../packages/localization/src/engine)                                                                                                                                                                                           |
| Window request modes                  | [`packages/localization/src/requestModes`](../packages/localization/src/requestModes)                                                                                                                                                                               |
| MT module facade                      | [`packages/localization/src/modules/MTModule.ts`](../packages/localization/src/modules/MTModule.ts)                                                                                                                                                                 |
| MT prompt/response collaborators      | [`packages/localization/src/modules/MTModulePromptParams.ts`](../packages/localization/src/modules/MTModulePromptParams.ts), [`MTBatchResponseProcessor.ts`](../packages/localization/src/modules/MTBatchResponseProcessor.ts)                                      |
| TM/TB prompt modules                  | [`packages/localization/src/modules/TMModule.ts`](../packages/localization/src/modules/TMModule.ts), [`TBModule.ts`](../packages/localization/src/modules/TBModule.ts)                                                                                              |
| Source terminology precheck           | [`packages/localization/src/SourceTerminologyExtractor.ts`](../packages/localization/src/SourceTerminologyExtractor.ts), [`LocalizationSourceTerminologyPrechecker.ts`](../packages/localization/src/LocalizationSourceTerminologyPrechecker.ts)                    |
| Runtime TM merge                      | [`packages/localization/src/runtimeTm`](../packages/localization/src/runtimeTm)                                                                                                                                                                                     |
| Shared match services                 | [`packages/localization/src/services`](../packages/localization/src/services)                                                                                                                                                                                       |
| Desktop TM match facade/collaborators | [`apps/desktop/src/main/services/TMService.ts`](../apps/desktop/src/main/services/TMService.ts), [`TMMatchScoring.ts`](../packages/localization/src/services/TMMatchScoring.ts), [`TMMatchSelection.ts`](../packages/localization/src/services/TMMatchSelection.ts) |
| TM/TB repositories                    | [`packages/db/src/repos/TMRepo.ts`](../packages/db/src/repos/TMRepo.ts), [`TMSyncRepo.ts`](../packages/db/src/repos/TMSyncRepo.ts), [`TBRepo.ts`](../packages/db/src/repos/TBRepo.ts)                                                                               |
| Desktop segment behavior              | [`apps/desktop/src/main/services/SegmentService.ts`](../apps/desktop/src/main/services/SegmentService.ts)                                                                                                                                                           |
| Desktop TM/TB modules                 | [`apps/desktop/src/main/services/modules/TMModule.ts`](../apps/desktop/src/main/services/modules/TMModule.ts), [`TBModule.ts`](../apps/desktop/src/main/services/modules/TBModule.ts)                                                                               |

## Change checklist

When changing this system:

1. Identify the owner layer and keep app shells thin.
2. Test protected tags and literal placeholder-like text.
3. Test missing/extra/out-of-order provider ids and repair boundaries when response behavior changes.
4. Test persistent and Runtime TM limits/dedup separately when reference selection changes.
5. Test default/CJK and English profiles separately when normalization or recall changes.
6. Test transaction, FTS, cache invalidation, cancellation, and missing-file behavior for resource changes.
7. Update this document only with the durable resulting contract.
