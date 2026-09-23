# momoCAT

momoCAT 是一个基于 Electron、React、TypeScript 和 SQLite 的桌面 CAT（计算机辅助翻译）工具，同时提供可独立运行的 `momocat` CLI 与共享本地化引擎。

当前发布基线为 `1.2.0`。工程文档从 [`DOCS/`](DOCS/README.md) 进入，开发代理从 [`AGENTS.md`](AGENTS.md) 进入。

## 主要能力

- Token-based 编辑，保护成对标签、独立占位符和受保护标记
- Working TM、Main TM、精确/模糊匹配与 Concordance（FTS5）
- TB 术语库、英文/CJK 匹配策略与编辑器实时命中
- CSV/XLSX 导入导出、列映射及 TM/TB 外部表格同步
- AI 翻译、项目级连接/模型/提示词配置与可恢复文件任务
- 重复段落跟随/脱离语义、Working TM 原子更新与桌面引用刷新
- 面向自动化的 `momocat` CLI：环境检查、项目检查、无请求 inspect、文件翻译与续跑

## 快速开始

准备 Git 和 [开发环境要求](DOCS/DEVELOPMENT.md#prerequisites-and-setup) 中的 Node/npm，在 Windows 或 macOS 的仓库根目录运行：

```bash
npm ci
npm run dev
```

安装与启动命令会处理 Electron 原生依赖。切换到测试、CLI 或打包时，遵循 [开发与验证](DOCS/DEVELOPMENT.md)。

## 常用命令

| 目标                 | 命令                                  |
| -------------------- | ------------------------------------- |
| 启动桌面开发环境     | `npm run dev`                         |
| 运行全部 Vitest 测试 | `npm test`                            |
| 运行跨仓库质量门     | `npm run gate:check`                  |
| 构建桌面应用         | `npm run build`                       |
| 构建共享引擎与 CLI   | `npm run build:cli`                   |
| 运行源码版 CLI       | `npm --silent run cli -- <arguments>` |

完整命令、桌面 e2e 与平台打包步骤见 [Development](DOCS/DEVELOPMENT.md#command-map)；CLI 安装、自动化与续跑见 [CLI 操作手册](DOCS/CLI.md)。

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
- [按任务查找所属文档、代码与测试](DOCS/README.md#common-task-map)
- [桌面 GUI、编辑器状态与 IPC](DOCS/DESKTOP.md)

## 本地数据

开发模式默认把 SQLite 数据库、AI runtime sidecar 和项目文件缓存放在 `.cat_data/`。该目录已被 Git 忽略，不应把真实项目内容、API key、provider endpoint 或诊断 artifact 提交到仓库。

## 许可

仓库当前未包含 `LICENSE` 文件。对外分发或复用前应先补充并确认明确的软件许可。
