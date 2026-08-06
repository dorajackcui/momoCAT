# momoCAT

momoCAT 是一个基于 Electron、React、TypeScript 和 SQLite 的桌面 CAT（计算机辅助翻译）工具，同时提供可独立运行的 `momocat` CLI 与共享本地化引擎。

当前发布基线为 `1.0.9`。当前行为以代码、测试和 [`DOCS/`](DOCS/README.md) 中的主题文档为准；仓库不再维护容易失真的“当前状态”或长期 roadmap 文档。

## 主要能力

- Token-based 编辑，保护成对标签、独立占位符和受保护标记
- Working TM、Main TM、精确/模糊匹配与 Concordance（FTS5）
- TB 术语库、英文/CJK 匹配策略与编辑器实时命中
- CSV/XLSX 导入导出、列映射及 TM/TB 外部表格同步
- AI 翻译、项目级连接/模型/提示词配置与可恢复文件任务
- 重复段落跟随/脱离语义、Working TM 原子更新与桌面引用刷新
- 面向自动化的 `momocat` CLI：环境检查、项目检查、无请求 inspect、文件翻译与续跑

## 快速开始

### 环境

- 推荐使用 Volta；仓库固定 Node.js `20.19.0` 和 npm `10.8.2`
- Git
- Windows 或 macOS（桌面应用与安装包需要在目标原生平台验证）

```bash
npm ci
npm run dev
```

`npm ci` 会执行 Electron 原生依赖重建；`npm run dev` 也会在启动前确保原生模块 ABI 正确。

## 常用命令

| 目标                 | 命令                                  |
| -------------------- | ------------------------------------- |
| 启动桌面开发环境     | `npm run dev`                         |
| 运行全部 Vitest 测试 | `npm test`                            |
| 运行跨仓库质量门     | `npm run gate:check`                  |
| 仅检查文档系统       | `npm run docs:check`                  |
| 构建桌面应用         | `npm run build`                       |
| 构建共享引擎与 CLI   | `npm run build:cli`                   |
| 运行源码版 CLI       | `npm --silent run cli -- <arguments>` |
| Windows 原生打包     | `npm run pack:win`                    |
| macOS 原生打包       | `npm run pack:mac`                    |

桌面 smoke 与完整 e2e：

```bash
npm run test:e2e:smoke --workspace=apps/desktop
npm run test:e2e --workspace=apps/desktop
```

## 仓库结构

```text
apps/desktop/          Electron 桌面应用（main / preload / renderer）
apps/cli/              momocat 命令行外壳
packages/core/         纯类型、文本/标签、QA、提示词与响应契约
packages/db/           SQLite 当前 schema 与 repositories
packages/localization/ 无界面本地化编排、文件任务、TM/TB/MT 模块
scripts/               构建、质量门、trace 与 smoke 工具
DOCS/                  当前有效的工程文档
```

## 文档导航

- [Agent 工作要求与完成标准](AGENTS.md)
- [文档入口与维护规则](DOCS/README.md)
- [系统架构](DOCS/ARCHITECTURE.md)
- [开发与验证](DOCS/DEVELOPMENT.md)
- [数据模型](DOCS/DATA_MODEL.md)
- [CLI 操作手册](DOCS/CLI.md)
- [本地化引擎、MT、TM 与 TB](DOCS/LOCALIZATION.md)

## 本地数据

开发模式默认把 SQLite 数据库、AI runtime sidecar 和项目文件缓存放在 `.cat_data/`。该目录已被 Git 忽略，不应把真实项目内容、API key、provider endpoint 或诊断 artifact 提交到仓库。

## 许可

仓库当前未包含 `LICENSE` 文件。对外分发或复用前应先补充并确认明确的软件许可。
