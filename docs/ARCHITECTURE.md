# QuietDesk 架构基线

> 状态：阶段 0 的架构约束，不代表应用已实现。公共类型、IPC 字段和数据库 schema 在阶段 2 写入 `docs/CONTRACTS.md` 后才视为冻结。

## 目标与不可替代约束

QuietDesk 是 Windows 本地 Electron 桌面小组件原型。核心同时包括本地数据可靠性、受限进程边界和真实桌面语义。网页预览、普通无边框窗口或 `alwaysOnTop: false` 不能替代 Windows 桌面宿主。

阶段 1 必须优先验证桌面宿主。若真实宿主不可行，可保留清楚标识的开发降级窗口供后续业务开发使用，但最终状态必须是“开发预览，桌面验收未完成”，不得静默降级或宣称桌面能力完成。

## 进程与依赖边界

```text
Widget / Capture / Library renderer
        │ 仅调用类型明确的 window.quietDesk API
        ▼
preload 白名单（contextBridge）
        │ 固定 IPC channel + 运行时输入校验
        ▼
主进程 IPC ──► domain/services ──► repository ──► SQLite
    │                  │                    （仅主进程访问）
    │                  └── Clock / 应用时区 / 操作历史
    ▼
DesktopHostAdapter ──► Windows Shell / native helper（如实测需要）
```

- Renderer：只负责界面、输入状态和展示，不直接访问 Node、SQLite、任意文件路径、SQL 或 shell。
- Preload / IPC：只暴露列入契约的窄接口；请求和响应有类型、运行时校验、明确错误及订阅清理。
- Domain / services：承载任务、笔记、日程、草稿、Daily Log、删除传播和时间规则，可注入 `Clock` 独立测试。
- Data：主进程侧 SQLite、迁移和事务；正式、开发、测试、演示数据目录从启动之初隔离。
- Desktop：窗口生命周期和 Windows 宿主封装在 `DesktopHostAdapter`，业务与 UI 不依赖 Shell 内部句柄结构。

Electron 窗口保持 `contextIsolation: true`、`nodeIntegration: false`、renderer sandbox 与最小 CSP。Markdown 不执行原始 HTML，不默认加载远程图片；外链由主进程校验协议和目标后处理。

## 早期技术门槛

| 门槛 | 最晚验证阶段 | 通过证据 | 未通过时处理 |
| --- | --- | --- | --- |
| Windows 桌面宿主 | 阶段 1 | Windows 构建号、Win+D/覆盖/焦点/任务栏行为、运行模式和恢复日志 | 只保留显式开发降级；阻塞“桌面小组件完成”声明 |
| 连续缩放与 DPI | 阶段 1 | 非预设尺寸、最小尺寸、重启恢复、跨屏/移屏边界与命中证据 | 修复适配器或布局；不改成仅预设尺寸 |
| Electron 中 SQLite 原生模块 | 阶段 2 | Electron 进程内迁移、事务、写入、关闭重开读回 | 调整兼容版本/rebuild；不能用 Node-only、内存或 localStorage 冒充 |
| v1 公共契约 | 阶段 2 | `CONTRACTS.md`、公共类型、运行时校验和契约测试 | 禁止 Data/UI 并行发明临时接口 |
| Windows 打包后的 SQLite/native 资源 | 阶段 6 | 断网、中文和空格路径下的发布产物读写与重启 | 阻塞可交付 Windows 构建 |

桌面实现不得注入 Explorer、替换 Shell 或要求应用日常以管理员身份运行。若使用 Progman/WorkerW 等 Shell 内部结构，文档必须标为非稳定实现依赖，并记录当前 Windows 构建、发现方式、诊断状态和 Explorer 重启后的恢复路径。透明/磨砂是可降级增强；优先保证不透明窗口的桌面行为与连续缩放。

## 数据与时间边界

- 任务的计划日期、截止日期和完成时间分开；日程的定时半开区间与全天 date-only 半开区间分开。
- 持久化时间点使用 UTC；计划日、应用时区和历史归属日期是不同概念。
- Daily Log 自动区保存可追溯实体关联和必要快照，手写补充区独立；重复生成幂等。
- 删除先进入回收站；永久删除仅清理由应用管理的正文、关联快照和派生记录，不改写独立导出或用户手写同词内容。
- 草稿自动保存与正式提交分开；正式保存、草稿清理和事件发布的事务/幂等规则在阶段 2 契约中固定。

## 阶段依赖

| 阶段 | 交付 | 入口依赖 | 出口门槛 |
| --- | --- | --- | --- |
| 0 | 环境、规格、验收、架构与分工 | 提示词包 | 本文档与进度报告完成，Git 仓库存在 |
| 1 | Windows 桌面宿主与缩放 spike | 阶段 0 | 宿主真实结果和显式降级模式已记录 |
| 2 | npm 脚手架、公共契约、三窗口空壳、SQLite 烟雾 | 阶段 1 适配器边界明确 | 契约冻结；Electron 内 SQLite 重启读回 |
| 3 | 数据层与 UI 并行实现并贯通 | 阶段 2 契约和存储门槛通过 | 核心任务/笔记/日程闭环使用真实数据 |
| 4 | 快捷捕获与 Markdown | 阶段 3 数据与 UI 闭环 | 草稿、失败保留、幂等提交和安全渲染可验证 |
| 5 | Daily Log、历史和删除传播 | 阶段 2 时间/历史契约及阶段 3/4 数据事件 | 跨天、补生成、删除恢复和导出通过真实 SQLite 场景 |
| 6 | 加固、Windows 打包和交付文档 | 阶段 1-5 | 发布产物离线运行；所有状态如实汇总 |
| 7 | 独立审查与最小修复 | 阶段 6 产物和证据 | 需求—实现—测试追踪完成，核心阻塞明确 |

阶段 1 宿主未通过不阻止阶段 2-5 的业务开发，但必须一直保留降级标识，并阻塞阶段 6/7 的完整桌面小组件结论。

## 文件所有权

| Owner | 默认允许修改 | 禁止自行修改的共享面 |
| --- | --- | --- |
| Lead / Integrator | 根构建配置、`package.json`、锁文件、`src/shared/`、`src/preload/`、`src/main/ipc/`、主入口、全局文档 | 无；但需先整合契约和审查现有用户改动 |
| Desktop | `src/main/windows/`、`src/main/platform/`、`native/` 及局部测试 | 共享类型、preload、IPC、根依赖和 Data/UI 目录 |
| Data | `src/domain/`、`src/main/data/`、`src/main/services/`、`tests/data/` | renderer、桌面适配器、共享契约和根依赖 |
| UI | `src/renderer/` 及局部组件测试 | 主进程数据/桌面代码、preload、IPC 和根依赖 |
| QA | `tests/e2e/`、`tests/platform/`、`docs/reviews/` | 独立审查时不修改生产代码 |

并行写入前由 Lead 冻结接口并给出不重叠路径。只有 Lead 执行 Git 切换、合并和提交；原生依赖重建与测试数据库不得由多个 agent 并行共享。

## 阶段 2 已落地决策

- 锁定 Electron 44.4.3、electron-vite 5.0.0、React 19.3.0、TypeScript 6.0.3、Vite 7.3.6、Vitest 4.1.11、Playwright 1.63.0、electron-builder 26.15.3 和 Zod 4.6.5；版本与 lockfile 由 npm 11.19.1 生成。
- `better-sqlite3@13.0.3` 已优先实测：Electron rebuild 在当前机器转入 node-gyp 后无法找到可用 Visual Studio C++ 工具链，安装退出 1。阶段 2 改用 Electron 44 所带 Node 24 的内置 `node:sqlite`，避免外部 ABI；已在真实 Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4 中完成关闭重开和进程重启读回。发布产物内读写仍留给阶段 6。
- `docs/CONTRACTS.md` 已冻结 v1：公共实体、Clock、时间/历史/删除/草稿语义，以及阶段 2 的 bootstrap、Note 烟雾和变更订阅接口。Data/UI 不再自行发明契约。
- Widget 继续使用阶段 1 唯一的 `DesktopHostAdapter`；Capture/Library 由主进程创建安全 BrowserWindow 空壳，普通启动时保持隐藏，不构成另一套桌面宿主。
- 正式、开发、demo 和测试路径在 `app.ready` 前分离；测试只使用 harness 新建的系统临时目录。

Windows Shell 的 WorkerW/Progman 仍是非公开结构，阶段 1 的精确几何失败和人工桌面验收缺口不因阶段 2 通过而消失。
