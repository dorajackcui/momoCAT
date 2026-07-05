# TM 外部文件同步方案（增量 diff 版）

日期：2026-07-05
状态：已实现（同日）。管线主体在 `apps/desktop/src/main/services/modules/tm/tmSyncPipeline.ts`，worker 为薄壳 `tmSyncWorker.ts`。
范围：`apps/desktop`（main 进程 + worker + IPC + 渲染端接入点）、`packages/db`（TMRepo 扩展）

## 0. 背景与目标

TB 已有"绑定本地 Excel → 一键同步"能力（`TBModule.syncTBEntriesFromExcel`），实现是**单事务清空 + 全量重写**的镜像。TM 需要同类能力，但规模不同：

- 典型文件 ≈ 155k 行：~150k 行对应库中已有条目（其中少量目标译文有修改），~5k 行为纯新增。
- `tm_fts` 是 trigram FTS5 虚表，整表重建 150k 行全文索引的成本（分钟级、巨事务、WAL 暴涨）不可接受；`usageCount`/`createdAt` 等条目元数据也不能像 TB 那样丢弃重建。

因此 TM 同步必须是**增量 diff/upsert**：不变的 ~145k 条零写入，只有新增/变更/（可选）删除的条目触碰 `tm_entries` 与 `tm_fts`。

## 1. 现状依赖（设计基座）

| 既有设施 | 位置 | 在本方案中的角色 |
| --- | --- | --- |
| `(tmId, srcHash)` 唯一索引 | `idx_tm_entries_tm_srcHash_unique`（currentSchema.ts） | 条目身份键 |
| `srcHash = computeSrcHash(matchKey, tagsSignature)` | `@cat/core/text` + `@cat/core/tag` | 文件行 → 身份的确定性映射 |
| worker 导入架构 | `tmImportWorker.ts` + `TMImportService`（worker 独立 `CATDatabase` 连接，WAL） | 同步 worker 直接复用此模式 |
| 分批事务 + `setImmediate` 让出 | `tmImportWorker` chunk 循环 | Apply 阶段沿用 |
| `replaceTMFtsBatch`（IN 批 900 删 + 逐条插） | `TMRepo` | 变更条目的 FTS 维护 |
| JobManager（jobId/进度/`cancelRequested`/CancellationToken） | `apps/desktop/src/main/JobManager.ts` | 进度与取消通道 |
| TB 同步的 config/outcome 存储 | `app_settings` key `tb-sync-config:<tbId>` | 照搬为 `tm-sync-config:<tmId>` |
| 引用缓存失效 | `notifyReferenceDataChanged({kind:'tm', ...})`（tm-imported 已走此路径） | 同步完成后失效 referenceLookupWorker 缓存 |

**明确不复用**：TB 的 clear+rewrite 镜像、单一大事务、`upsertTMEntryBySrcHash`（它会 `usageCount+1`，同步语义下会把 150k 条的使用计数每次同步都污染一遍）。

## 2. 条目身份匹配

- **身份键**：`(tmId, srcHash)`。文件每行经 `parseDisplayTextToTokens(srcText)` → `computeTagsSignature` / `computeMatchKey` → `computeSrcHash`，与库内唯一索引完全一致。不引入行号身份、不做模糊身份匹配。
- **源文被编辑的行**：旧 srcHash 消失、新 srcHash 出现 → 表现为"一删（受删除策略控制）一增"，不是 update。这是身份键方案的固有语义，需在 UI 文案中说明。
- **文件内重复 srcHash**：staging 表以 `srcHash` 为主键 `INSERT OR REPLACE`，**last-wins**（与 Excel"后面的行是最新修订"直觉一致），重复行数计入报告 `duplicates`。
- **变更检测键**：staged 行的 `tgtText`（token contents join，即写入 `tm_fts.tgtText` 的同一字符串）与 `targetTokensJson`。对比策略见 §4。

## 3. 数据流总览（三阶段，全部在 worker 线程）

```
tmSyncWorker (worker_threads, 独立 CATDatabase 连接, WAL)
  Phase A  Parse & Stage   读 Excel → 逐行 tokenize/hash → tm_sync_staging   (0–40%)
  Phase B  Diff (纯 SQL)    staging ⟕ tm_entries 集合运算 → 三个变更集         (40–50%)
  Phase C  Apply           分批事务 insert / update / prune + FTS 维护        (50–100%)
```

主进程只负责：IPC handler、JobManager 进度转发、向 worker 转发 cancel。渲染进程只订阅 `onJobProgress`。

### Phase A — Parse & Stage（流式，控内存）

1. `XLSX.read(..., { dense: true })` 读工作簿（xlsx 库无真流式 API，整簿加载不可避免；dense 模式显著降低 155k 行的对象开销）。
2. `extractSheetRows` 取 source/target 列后**立即释放 workbook 引用**。
3. 逐行：trim → 空行计 `skipped` → tokenize → 计算 `srcHash/matchKey/tagsSignature/srcText/tgtText/sourceTokensJson/targetTokensJson`。
4. 写入 staging 表，**每 2000 行一个事务**，行间不保留 JS 侧累积结构（单条 prepared statement 复用）。

staging 用**普通表**而非 `CREATE TEMP TABLE`：`CATDatabase` 连接统一设了 `temp_store = MEMORY`，155k 行 staging（两份 tokensJson + 文本，粗估 100MB+）放 temp 会撑爆 worker 内存；普通表落盘、结束后清理。

```sql
CREATE TABLE IF NOT EXISTS tm_sync_staging (
  tmId TEXT NOT NULL,           -- 清理按 TM 作用域，并发同步互不干扰
  syncRunId TEXT NOT NULL,
  srcHash TEXT NOT NULL,
  matchKey TEXT NOT NULL,
  tagsSignature TEXT NOT NULL,
  sourceTokensJson TEXT NOT NULL,
  targetTokensJson TEXT NOT NULL,
  srcText TEXT NOT NULL,
  tgtText TEXT NOT NULL,
  PRIMARY KEY (syncRunId, srcHash)
) WITHOUT ROWID;  -- INSERT OR REPLACE 实现文件内 last-wins 去重
```

每次同步开始先 `DELETE FROM tm_sync_staging WHERE tmId = :tmId AND syncRunId != :runId`（清理本 TM 上次崩溃/取消的残留；限定 tmId 是因为不同 TM 允许并发同步，不能互删 staging），结束（含 catch/finally）删除本次 runId 的行。

### Phase B — Diff（纯 SQL，不在 JS 建 150k Map）

```sql
-- 新增（预期 ~5k）
SELECT s.* FROM tm_sync_staging s
LEFT JOIN tm_entries e ON e.tmId = :tmId AND e.srcHash = s.srcHash
WHERE s.syncRunId = :runId AND e.id IS NULL;

-- 变更（预期小子集；目标或源显示形式任一变化都算 changed ——
-- srcHash 由归一化 matchKey 派生，大小写/空白变化不改 hash 但要跟随文件）
SELECT s.*, e.id AS entryId FROM tm_sync_staging s
JOIN tm_entries e ON e.tmId = :tmId AND e.srcHash = s.srcHash
WHERE s.syncRunId = :runId
  AND (e.targetTokensJson != s.targetTokensJson
    OR e.sourceTokensJson != s.sourceTokensJson);

-- 文件中已不存在（仅 deletePolicy != 'never' 时计算）
SELECT e.id FROM tm_entries e
WHERE e.tmId = :tmId
  AND NOT EXISTS (SELECT 1 FROM tm_sync_staging s
                  WHERE s.syncRunId = :runId AND s.srcHash = e.srcHash);
```

- join 走 `idx_tm_entries_tm_srcHash_unique` + staging 主键，150k×150k 也在亚秒级。
- **禁止**用 `tm_fts` 参与 diff join（`tmEntryId` 在 fts5 中 UNINDEXED，按它过滤是全表扫描）。
- 变更集不一次性 `all()` 进 JS：用 `.iterate()` 或分页（`LIMIT/OFFSET` on staging PK）按 apply 批的粒度拉取。
- `unchanged = staging总数 - new - changed`，**零写入**——这是整个方案的性能来源。

**变更比较用 `targetTokensJson` 字符串相等**的依据与代价：文件行和历史 import/sync 写入的条目都出自同一 `parseDisplayTextToTokens` + `JSON.stringify`，比较稳定；由 `commitToMainTM` 从段落写入的条目，token 元数据可能与纯文本 parse 不一致，会在**首次同步**被判为 changed 并按 file-wins 改写一次，之后收敛稳定。即最坏情况只发生在绑定文件后的第一次同步（changed 集偏大），报告中如实展示。若未来要消除这一次性成本，可加列 `syncedContentHash`（需 schema migration，列为 v2，见 §10）。

### Phase C — Apply（分批事务，幂等）

按 `insert → update → prune` 顺序，**每批 1000–2000 条一个事务**，批间 `setImmediate` 让出以处理 cancel 消息：

- **insert**（新增 ~5k）：`INSERT INTO tm_entries(...) ON CONFLICT(tmId, srcHash) DO NOTHING`（幂等，防重跑冲突）+ 同事务内 `INSERT INTO tm_fts`。`usageCount = 0`、`createdAt = now`。
- **update**（changed 集）：**新增专用语句**，不走 `upsertTMEntryBySrcHash`：

  ```sql
  UPDATE tm_entries
  SET sourceTokensJson = :src, targetTokensJson = :tgt,
      updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = :entryId;
  ```

  不动 `usageCount`、`createdAt`、`originSegmentId`；`matchKey`/`tagsSignature` 由 srcHash 恒等保证不变，无需回写。同事务内用 `replaceTMFtsBatch`（IN 批 900 删 + 插）更新 FTS（srcText/tgtText 都刷新）。
- **prune**（仅 `deletePolicy: 'prune-all'`）：`DELETE FROM tm_fts WHERE tmEntryId IN (...)`（批 900）+ `DELETE FROM tm_entries WHERE id IN (...)`，同事务。
- **FTS 一致性不变式**：条目行与其 `tm_fts` 行永远在同一事务内成对写入/删除，任何批的回滚不会留下悬挂 FTS 行。
- **可选 FTS 优化**：本次 FTS 写入量（insert+update+prune 条数）> 20k 时，末尾追加独立事务 `INSERT INTO tm_fts(tm_fts) VALUES('optimize')`；可被取消跳过，不影响正确性。

## 4. 冲突与删除语义

- **方向**：单向，文件 → TM。TM 侧对同一 srcHash 的本地修改在同步时被文件覆盖（**file-wins**，与 TB 行为一致、可预期）。没有三方基线（库里不存"上次同步时的值"），v1 不做逐条冲突仲裁；`lastSyncedAt` 之后 `updatedAt` 变过又被改写的条目计入报告 `overwrittenLocalEdits` 计数，让用户知情。
- **删除策略** `deletePolicy`（存于 sync config，UI 可选）：
  - `'never'`（**默认**）：纯 upsert。TM 同时接收 `commitToMainTM` 的翻译产出，这些条目不在外部文件中，镜像删除会误伤——150k 级主 TM 必须默认保守。
  - `'prune-all'`：完全镜像文件。执行前 UI 必须展示"将删除 N 条"并二次确认（N 来自 Phase B 的 deleted 计数，可先 diff 后确认再 apply，见 §6 取消语义）。
  - `'prune-synced'`（v2）：只删"由同步管理"的条目，需要 origin 标记列，暂不做。
- **元数据**：同步永不重置 `usageCount`/`createdAt`；update 仅改 source/target 显示 tokens 与 `updatedAt`。

## 5. 事务、并发与 SQLite 细节

- worker 独立连接，主库已是 WAL + `synchronous = NORMAL`：worker 写、主进程读并发安全；写-写冲突（用户同时确认段落触发 `commitToMainTM`）由小批事务的间隙消化，worker 连接补设 `pragma busy_timeout = 5000`（当前 `CATDatabase` 未设，遇锁会立即 SQLITE_BUSY）。
- 全程**不出现跨 150k 行的大事务**：staging 写入、apply 全部 ≤2000 行/事务；WAL 文件不膨胀，主进程读不被长写者饿死。
- 单批必须原子（条目 + FTS 成对）；批与批之间的中间态是"前缀已同步"的一致状态。

## 6. 进度 / 取消 / 失败恢复

**进度**：复用 JobManager + `onJobProgress`。worker `postMessage({type:'progress', phase, current, total, message})`；映射：Parse 0–40%、Diff 40–50%（含各集合计数首次可见）、Apply 50–100%（按 changed+new+deleted 总数推进）。`ImportJobResult.kind` 增加 `'tm-sync'`，result 携带完整报告：

```ts
interface TMSyncReport {
  fileRows: number; duplicates: number; skipped: number;   // Phase A
  added: number; updated: number; deleted: number;          // Phase C 实际应用数
  unchanged: number; overwrittenLocalEdits: number;
}
```

**取消**：`jobManager.cancelJob(jobId)` → handler 侧 `worker.postMessage({type:'cancel'})` → worker 在每批事务提交后检查标志位：停止后续批，当前未提交事务自然回滚，清理 staging，回 `{type:'done', cancelled: true, result: 已应用计数}`。任何阶段都可取消：Parse/Diff 期取消零写入；Apply 期取消留下"前缀已应用"的一致状态。启动窗口（文件预检、worker 路径解析，worker 尚未注册）内到达的取消由 service 记入 `pendingCancels`，worker 一创建立即补投递，不会丢失。

**失败恢复**：核心是**幂等 + 收敛，不做 journal 断点续传**。任意批失败 → 该批回滚 → worker 上报 error → job failed。此时库处于部分同步但逐条完整的状态；用户重跑同步，Phase B 会把已应用的条目判为 unchanged 自动跳过，剩余工作量单调递减直至收敛。staging 残留由 runId 清理规则兜底（§3 Phase A）。进程崩溃同理（WAL 保证最后一批回滚）。

**结果记录**：`app_settings` key `tm-sync-config:<tmId>`，结构同 `TBSyncConfig` 增补 `deletePolicy`、`lastSyncReport`（摘要）与 `lastSyncAttemptedAt`。`lastSyncedAt` 是下一次 diff 的 `overwrittenLocalEdits` 基线，**只在完整成功时前移**——失败/取消的 run 只应用了前缀，若也推进基线，未应用余段里的本地编辑会在下次同步时漏出覆盖计数被静默改写；每次 run（无论结局）都写 `lastSyncAttemptedAt` 驱动 UI 状态展示。`overwrittenLocalEdits > 0` 时完成/取消通知附带覆盖警告文案。

## 7. 内存预算

| 项 | 峰值 | 说明 |
| --- | --- | --- |
| XLSX workbook + rows | ~30–80MB | dense 模式；staging 写完立即释放 |
| 逐行 token/hash 计算 | O(1) | 单行处理，无累积数组 |
| Diff | ~0 JS 内存 | 全在 SQLite；结果集 iterate 分批拉取 |
| Apply 批 | ≤2000 行 | 每批用完即弃 |
| staging 表 | 磁盘 | 普通表，避开 `temp_store=MEMORY` |

不在 JS 里构建 150k 条的 `Map<srcHash, entry>`；worker 内存与渲染/主进程完全隔离。

## 8. UI 不阻塞

- 重活全部在 `tmSyncWorker`（worker_threads）；主进程仅消息转发，事件循环无 >几 ms 的占用。
- worker 失败**不做主线程回退**（与 `TMImportService` 的 fallback 不同——150k 级同步在主进程跑必然卡 UI，宁可报错）。
- 完成后 `notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-synced' })`，走 `tm-imported` 同一条缓存失效路径（referenceLookupWorker / 预取缓存）。
- 渲染端复用 TB 同步的交互骨架：绑定文件 + 列配置（`TMSyncColumns` = sourceCol/targetCol/hasHeader）、同步按钮、`useAIJob` 式进度订阅、取消按钮、上次同步状态徽标；`prune-all` 模式下 apply 前的删除确认对话框。

## 9. 实现清单

| 层 | 变更 |
| --- | --- |
| `shared/ipc.ts` | `TMSyncColumns` / `TMSyncConfigInput` / `TMSyncConfig` / `TMSyncStartResult` / `TMSyncReport`；`ImportJobResult.kind` += `'tm-sync'` |
| `shared/ipcChannels.ts` | `tm.syncSetConfig` / `tm.syncExecute` / `tm.syncCancel`（cancel 也可复用通用 job cancel） |
| `main/ipc/tmHandlers.ts` | 仿 `tbHandlers.syncExecute`：file-missing 预检、startJob、进度转发、cancel 转发、`notifyReferenceDataChanged` |
| `main/services/modules/tm/TMSyncService.ts`（新） | worker 启停、消息协议、config 读写（`tm-sync-config:<tmId>`）、outcome 记录 |
| `main/tmSyncWorker.ts`（新） | 三阶段管线本体（仿 `tmImportWorker` 骨架 + cancel 监听） |
| `packages/db` `TMRepo` | staging DDL/清理、stage 插入、三个 diff 查询（iterate）、`insertSyncEntriesBatch`、`updateSyncTargetsBatch`（不动 usageCount）、`pruneEntriesBatch`、`optimizeTMFts` |
| 测试 | TMRepo 层：diff 正确性（new/changed/unchanged/deleted/文件内重复 last-wins）、update 不动 usageCount/createdAt、FTS 与条目行一一对应不变式；Service 层（仿 `TBModule.sync.test.ts`）：进度事件、取消后一致性、失败重跑收敛、deletePolicy 三态 |

## 10. 性能预估与 v2 余量

155k 行重复同步（5k 新增 + 少量变更）预估：Parse+tokenize+hash ~10–30s（不可避免的大头）、staging 写入 ~2–4s、diff <1s、apply（5k FTS trigram 插入 + 变更集）~2–5s，**总计 ~20–40s**；对比全量镜像（150k trigram FTS 重建 + 巨事务）的分钟级且不可取消，且本方案不变条目零磨损（usageCount/updatedAt 不被污染，`idx_tm_entries_tm_updatedAt` 上的统计查询语义保持正确）。

v2 备选（按需再做，v1 不做）：

1. **原始行快照缓存**：持久表存 `hash(rawSrc + rawTgt) → (srcHash, targetTokensJson)`，未变原始行跳过 tokenize，把 Parse 阶段压到秒级。
2. `syncedContentHash` 列：消除 `commitToMainTM` 来源条目首次同步的一次性 changed 放大。
3. `'prune-synced'` 删除策略（需 origin 标记）。
4. Parse 并行化（分片多 worker）——仅当 1 不够时考虑。
