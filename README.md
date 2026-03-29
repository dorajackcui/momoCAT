# Simple CAT Tool

一个基于 Electron + React + TypeScript 的桌面 CAT（计算机辅助翻译）工具。

## 当前状态

- 当前主线：`v0.3` 进行中
- 当前重点：**正确性收口 + 解耦改造 + 类型契约收紧**
- 版本与状态：`DOCS/40_STATUS_AND_ROADMAP.md`

## 主要能力

- Token-based 编辑（标签/占位符安全）
- 多 TM 架构（Working TM + Main TM）
- 100% 匹配 + 模糊匹配
- Concordance（FTS5）
- TB 术语库（管理、挂载、编辑器命中）
- CSV/XLSX 导入导出（含列映射）
- AI 翻译与项目级 AI 设置

## 快速开始

### 环境

- Volta（推荐，用于锁定 Node/npm 版本）
- Node.js `20.19.0`（若不使用 Volta）
- npm `10.8.2`（若不使用 Volta）
- Git
- VS Code（可选）

首次安装 Volta 后，在仓库根目录执行命令会自动使用 `package.json` 中固定的 Node/npm 版本。

### 运行

```bash
npm ci
npm run dev
```

### 构建

```bash
npm run build
npm run pack
```

平台定向打包命令：

```bash
# 仅可在 macOS 执行（产出 .dmg）
npm run pack:mac

# 仅可在 Windows 执行（产出 .exe）
npm run pack:win
```

说明：

- `npm run pack` 只会在当前宿主平台执行桌面打包，适合本机构建验证
- 交付前的平台验收请使用平台原生命令：Windows 用 `npm run pack:win`，macOS 用 `npm run pack:mac`

### 测试

```bash
npm test
```

桌面行为验证：

```bash
# 桌面 smoke 验证（优先用于编辑器/交互行为回归）
npm run test:e2e:smoke --workspace=apps/desktop

# 完整桌面 e2e
npm run test:e2e --workspace=apps/desktop

# 跨平台基线质量门
npm run gate:check
```

## Win + Mac 双环境开发约定

- 通用命令统一为：`npm ci`、`npm run dev`、`npm test`、`npm run build`
- 原生模块重建统一为：`npm run rebuild:electron`（已兼容 zsh / PowerShell）
- Windows 仅在 Windows 机器上验收 `.exe`；macOS 仅在 macOS 机器上验收 `.dmg`
- 跨平台质量门由 GitHub Actions 矩阵（`macos-latest` + `windows-latest`）执行

## 平台命令边界

- 双平台通用入口：`npm ci`、`npm run rebuild:electron`、`npm run dev`、`npm test`、`npm run build`、`npm run gate:check`
- 桌面行为测试入口：`npm run test:e2e:smoke --workspace=apps/desktop`，需要完整桌面回归时再运行 `npm run test:e2e --workspace=apps/desktop`
- `npm run pack` 是“当前机器打当前平台包”，不是 Win/mac 交叉验收命令
- Windows 打包验收只用 `npm run pack:win`
- macOS 打包验收只用 `npm run pack:mac`

## 项目结构（简版）

```text
apps/desktop/    # Electron 应用（main/preload/renderer）
packages/core/   # 核心类型与算法
packages/db/     # SQLite 数据层（迁移 + repos）
DOCS/            # 项目文档
```

详细结构见：`DOCS/10_ARCHITECTURE.md`

## 文档入口

- Start here: `DOCS/00_START_HERE.md`
- Architecture: `DOCS/10_ARCHITECTURE.md`
- Engineering runbook: `DOCS/20_ENGINEERING_RUNBOOK.md`
- Data model: `DOCS/30_DATA_MODEL.md`
- Status and roadmap: `DOCS/40_STATUS_AND_ROADMAP.md`
- Historical consolidation: `DOCS/90_HISTORY_CONSOLIDATED.md`

## 运行数据说明

- 开发模式下用户数据默认在：`.cat_data/`
- 该目录包含 SQLite 数据库与项目文件缓存

## License

MIT
