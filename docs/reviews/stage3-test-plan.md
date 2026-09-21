# STAGE3-QA-PLAN：核心数据与 Widget 独立测试计划

任务标识：`STAGE3-QA-PLAN`

计划日期：2026-09-21（Asia/Shanghai）

当前状态：测试设计 `PASS`；阶段 3 QA 自动化已实现。首次真实 Electron 执行在未集成 handler 门槛处 `FAIL`，门槛之后的业务与视觉情境仍为 `NOT_RUN`。

## 1. 范围、基线与判定边界

本计划覆盖阶段 3 的 Task、Note、Schedule、Draft 数据行为，以及 Widget、Capture、Library 的基础 UI。依据是 `AGENTS.md`、`docs/PRODUCT.md`、`docs/ACCEPTANCE.md`、`docs/CONTRACTS.md`、`docs/PROGRESS.md` 和当前 `tests/**`。

当前基线只有阶段 2 的 Note 烟雾读写、三窗口安全空壳和变更 revision。Task/Schedule/Draft 的业务 IPC、Widget 业务快照、主题/语言设置尚未暴露；阶段 3 开始测试实现前，Lead 必须先扩展并冻结这些公共契约。这个前置条件不是理由去 mock renderer，也不能由 QA、Data 或 UI 私自修改 `src/shared`、preload、IPC 或依赖。

阶段 1 的 150% DPI 精确窗口几何仍为 `FAIL`，Win+D、覆盖、任务栏/Alt+Tab、真实连续缩放等仍为 `NOT_RUN`。这些缺口不阻止阶段 3 的业务与 renderer 验证，但阻止“桌面小组件已完成”的结论。本计划的 Electron 截图只证明 renderer 布局，不替代桌面宿主证据。

## 2. 测试隔离与固定数据

- 每次 Data、Electron integration、E2E 和视觉运行都创建独立 `%TEMP%/quietdesk-stage3-*` 根目录；应用启动前通过现有测试入口指定 userData。禁止读取或写入正式 userData。
- 所有跨日业务测试注入 `FixedClock`，默认应用时区固定为 `Asia/Shanghai`，不得修改系统时间或真实等待跨日。
- 标准日期：昨天 `2026-09-20`、今天 `2026-09-21`、明天 `2026-09-22`。
- 标准中文任务：标题 `整理 QuietDesk 阶段三验收 ✅`，正文 `检查 planDate / dueDate，保留中英文 mixed text。`。
- 标准跨午夜日程：上海时间 `2026-09-21 23:30` 至 `2026-09-22 00:30`，即 UTC `[2026-09-21T15:30:00.000Z, 2026-09-21T16:30:00.000Z)`。
- 标准全天日程：date-only 半开区间 `[2026-09-21, 2026-09-23)`。
- 长文本包含中文标点、英文长词、URL、emoji、Markdown 符号和无空格片段，例如 `会议纪要 / ArchitectureReviewWithoutConvenientBreakPoints / https://example.invalid/very/long/path / 🌙✅`。
- 大量条目配置为 120 个当前任务、40 个已完成任务、60 个日程和 40 个笔记。压力数据可由主进程测试 setup 使用真实服务写入隔离 SQLite；renderer 仍必须从正式 preload API 读取，不能使用 localStorage、组件 mock 或静态卡片。
- 测试结束只清理本次 harness 明确创建且位于上述前缀下的目录。不得清理真实数据或无关进程。

## 3. 自动可执行：契约、domain 与 SQLite

这些用例由 Vitest/Data 局部测试执行；它们可以在普通 Node 中快速回归纯规则，但涉及 SQLite 的关键闭环还必须在第 4 节真实 Electron 中复验。

| ID | 场景 | 不得缺少的断言 | 证据 |
| --- | --- | --- | --- |
| S3-D01 | 创建、读取和编辑中文 Task/Note/Schedule | Unicode 原样读回；Task 的 `planDate`、`dueDate`、`completedAtUtc` 相互独立；更新不改写 `createdAtUtc`；SQL 特殊字符按正文保存而非执行 | 测试名、退出码、隔离 DB 路径、实体 ID |
| S3-D02 | 创建昨日未完成任务，Clock 前进到今天 | 任务仍出现在当前待办；原 `planDate=2026-09-20` 与 `dueDate` 完全不变；没有自动改期操作记录；未来任务不进入当前待办 | 固定 Clock、查询结果和前后实体快照 |
| S3-D03 | 完成、完成后重启读取、重新打开 | 完成后退出当前待办并进入历史；操作快照保留完成事实；重开后 `completedAtUtc=null`，且仅在 `planDate <= currentDate` 或无计划日时回到当前待办；完成与重开各有一条稳定排序记录 | task、operation sequence、查询结果 |
| S3-D04 | 改期 | 只改变用户指定的计划日或截止日；完成时间不受影响；写入一条包含变更前后必要快照的操作；未来计划任务从当前待办移出 | 修改前后记录和 operation snapshot |
| S3-D05 | 跨午夜 timed 日程按日重叠查询 | 9 月 21 日与 22 日各返回且各只出现一次；20 日和 23 日不返回；恰好等于日界线结束的区间不算重叠；不能按 `start date == query date` 实现 | 四日查询结果、应用时区和 UTC 边界 |
| S3-D06 | 多日 all-day 日程查询 | `[21,23)` 在 21、22 可见，在 20、23 不可见；不得构造 UTC 午夜替代 date-only | 四日查询结果和原始日期字段 |
| S3-D07 | 回收站与恢复 | Task/Note/Schedule 软删除后从普通查询、Widget 快照和自动派生入口隐藏，出现在回收站；恢复后原正文和日期不变，并按规则重新可见 | 删除/恢复前后实体、查询集合、change sequence |
| S3-D08 | 确认后的永久删除 | 未确认请求被拒绝；确认后在单一事务内清除实体正文、该实体的应用管理操作快照、自动派生项和关联幂等正文；所有已知应用管理表按实体 ID 检查无残留；不扫描或改写手写日志文字 | 表级查询、事务结果；不得只检查普通列表 |
| S3-D09 | Draft 持久化与 revision | 创建、关闭连接、重开后读回；正确 `expectedRevision` 才能更新；旧 revision 返回 `CONFLICT` 且不覆盖新内容；草稿逐字保存不进入工作历史 | revision 序列、重启读回、历史为空 |
| S3-D10 | 事务、幂等与提交后事件 | 同一幂等键+同一命令只写一次并返回原结果；同一键+不同命令 `CONFLICT`；实体、操作、receipt、change 在同一事务；失败时全部回滚且不发布 change；成功后 sequence 单调增加 | 行数、sequence、回滚后状态、事件计数 |
| S3-D11 | 编辑和删除的参数化 SQL | 标题/正文含引号、分号、注释符和 SQL 片段时数据库结构不变、内容原样保存；所有动态值走绑定参数 | schema/table 清单前后一致、原文读回 |
| S3-D12 | 当前与未来日期查询排序 | 当前查询只含未删除、未完成、无计划日或计划日不晚于应用日期的任务；未来查询按计划日及稳定次序返回；同时间戳用 operation sequence 稳定排序 | 完整期望 ID 序列，不只断言数量 |

建议执行命令（实现落地后由 Lead 固化到脚本）：

```text
npm run check
npx vitest run tests/data
```

若 UI 局部组件测试由 UI agent 放在 `src/renderer/**`，应由 Lead 将其纳入真实 `check` 或明确的测试脚本；不得创建永远不被项目脚本调用的测试来宣称覆盖。

## 4. Electron 可执行：真实进程、IPC 与重启

这里必须启动项目锁定的 Electron，使用真实 preload、主进程服务和隔离 SQLite。浏览器预览、renderer mock 和 BrowserWindow reload 都不能替代“重启”。

| ID | 场景 | 步骤与断言 | 证据 |
| --- | --- | --- | --- |
| S3-E01 | 中文任务真实创建并跨进程恢复 | 第一个 Electron 进程经登记窗口的 preload 创建标准中文任务并读回；完全关闭 DB 和应用；第二个 Electron 进程使用同一测试 userData 查询。两次内容、日期和 ID 相同，普通启动无 demo 数据 | 两个 PID/进程结果、Electron/Node/SQLite 版本、DB 路径、实体 ID |
| S3-E02 | 完成历史与重开回流 | 真实 UI/API 完成任务，关闭并重启后历史仍可查且当前列表不含它；再重开，历史保留完成与重开操作，任务回到符合日期条件的当前列表 | 两次重启、operation sequence、Widget/Library 查询结果 |
| S3-E03 | 昨日不自动改期 | 用固定 Clock 创建昨日任务，第二次启动使用今天；断言 Widget 当前待办仍含它且界面显示原计划日，SQLite 前后 `plan_date`/`due_date` 二进制等值 | 两进程快照、UI 文本、数据库读回 |
| S3-E04 | 跨午夜和全天日程双日可见 | 经真实 IPC 创建 S3-D05/D06 日程，在 Library 日期入口依次浏览 20、21、22、23；21/22 可见且不重复，20/23 不可见；过去日程仍标为计划而非“已参加” | 四日期 DOM 结果和实体 ID |
| S3-E05 | 跨窗口提交后刷新 | Widget、Capture、Library 同时打开；一窗创建/完成/重开/删除/恢复，其他窗口收到严格递增的提交后事件并重取快照；失败事务不刷新；窗口卸载后监听数回到基线 | 每窗 revision、事件 sequence、监听器计数 |
| S3-E06 | 真正的保存失败 | 在隔离 DB 上由测试辅助连接持有写事务，令真实主进程写入得到 `SQLITE_BUSY`/`STORAGE_ERROR`；UI 保留输入或草稿、显示可重试错误、不出现成功提示、不收起、不新增实体/operation/receipt/change。释放锁后重试成功且只创建一条 | 错误联合、失败前后行数/sequence、页面状态、重试结果 |
| S3-E07 | 三窗口产品路径 | 正常产品路径不注入 fixture；Widget/Capture/Library 均通过 preload 获取数据。开发 fixture 模式如存在，必须显示“开发预览”且不得计入 S3-E01 至 E06 | 启动参数、bootstrap capabilities、无 fixture 标志 |
| S3-E08 | renderer 安全边界 | 三窗中 `process`、`require`、`Buffer`、`module` 均为 `undefined`；`window.quietDesk` 键集合精确等于 Lead 冻结的允许列表；不能访问 SQL、数据库路径、文件系统、shell 或通用 channel；畸形 payload/错误窗口身份被拒绝 | 每窗 globals/API 清单、负向 IPC 结果 |
| S3-E09 | 空状态与大量数据 | 空库没有虚构卡片且显示可理解的空状态；压力数据来自真实 SQLite；Widget 限制首页条目并显示“还有 N 项”，已完成默认折叠，Library 可浏览全部，核心入口仍响应 | 实际条目数、DOM 可见数、滚动/入口断言 |
| S3-E10 | 中英文、浅色/深色/跟随系统 | `zh-CN`、`en-US` 可切换并持久化；未知 locale 回退 `en-US`；light/dark/system 设置重启后保持；system 模式使用 Electron 当前解析的系统配色而非硬编码第三套值 | 设置前后 bootstrap、重启读回、`prefers-color-scheme`/resolved theme |
| S3-E11 | 四种尺寸布局与交互 | 将 Widget 内容区分别设为 320×240、480×420、720×720、437×386；断言当前待办、今日安排、最近笔记、Capture 入口在 320×240 仍可发现；日期入口、折叠已完成和主要按钮可聚焦/点击；无水平溢出；交互区 `-webkit-app-region: no-drag` | 每尺寸 content bounds、DOM rect、点击/键盘结果 |

计划执行命令：

```text
npm run test:integration
npm run test:e2e
```

`test:integration` 必须至少包含 S3-E01 至 E06 的真实 Electron 数据闭环；`test:e2e` 必须至少包含 S3-E04 至 E11 的 renderer/IPC 行为。若脚本因环境不能运行，应返回非零或明确 `NOT_RUN`，不能打印虚假 PASS。

## 5. 视觉截图与实际检查

### 5.1 截图矩阵

在真实 Electron renderer 中生成完整基础矩阵：4 个内容尺寸 × 3 个主题设置 × 2 个 locale，共 24 张。

| 维度 | 值 |
| --- | --- |
| 尺寸 | `320×240`、`480×420`、`720×720`、`437×386` |
| 主题 | `light`、`dark`、`system`（同时记录当次 resolved light/dark） |
| 语言 | `zh-CN`、`en-US` |
| 基础数据 | 3 个当前任务、1 个今日跨午夜日程、2 个最近笔记、2 个今日已完成且默认折叠 |

另保存并检查以下状态截图：

- 空状态：Widget/Capture/Library，各至少中文和英文一张。
- 大量条目：Widget 在 320×240、480×420、720×720 各一张，Library 一张。
- 长中英混排：320×240 和 437×386 的 Widget，各主题至少一张；Capture/Library 各一张。
- 保存失败：Capture 或实际编辑表单在失败提示、保留输入、可重试状态下，中英文各一张。
- 今日已完成：折叠和展开各一张；默认截图必须是折叠态。
- 键盘焦点：Capture、日期浏览和任务完成控件各一张可见 focus ring。

文件放入被忽略的 `test-results/stage3/<run-id>/`，命名至少含窗口、尺寸、locale、主题、数据状态。每张截图记录像素尺寸、DIP/content 尺寸、Windows 缩放、Electron 版本、应用 revision 和 SHA-256；不得混入源码提交。

### 5.2 “实际检查”定义

截图生成后必须逐张以原尺寸打开检查，并在同目录保存 `visual-review.md` 或等价机器可读清单。每张都要有 `PASS`/`FAIL`、检查人/agent、检查时间和缺陷说明。只有生成文件、像素 diff 或脚本无异常不算视觉验收。

逐图检查：

- 无重叠、裁切、不可解释省略、水平滚动条、正文溢出或按钮落在可视区外。
- 中文、英文、emoji、长 URL 和无空格英文可换行或有明确省略策略，不遮挡日期/状态。
- 320×240 仍能发现“当前待办、今日安排、最近笔记、捕获”四个核心入口；空间不足时允许减少条目并显示准确剩余数，不能隐藏整个功能。
- 已完成默认折叠且不把历史堆满首页；展开后仍可收起。
- light/dark/system 的文本、边框、焦点、错误和禁用状态清晰；信息不只靠颜色表达。
- 使用系统字体栈和原创图形；未发现 Apple 字体、logo 或复制品牌素材。
- 捕获按钮、checkbox、日期入口及 Library 导航不落入拖动区域；按钮的 hover/focus/pressed 状态可辨。
- 大量条目时 Widget 保持摘要职责，Library 滚动正常；没有因压力数据破坏窗口圆角或底部入口。

发现任何视觉缺陷时保留失败截图，给出尺寸/主题/locale/数据状态和稳定复现步骤；修复后增加新截图，不覆盖失败证据。

## 6. 人工检查与条件性 NOT_RUN

| ID | 检查 | 当前分类与原因 |
| --- | --- | --- |
| S3-M01 | 实际 Windows 设置在浅/深之间切换时，应用 `system` 模式实时跟随 | 人工；修改用户系统外观可能影响工作。未在授权测试环境执行就记 `NOT_RUN`。Electron 内设置 `themeSource` 的自动测试只能作为子项证据 |
| S3-M02 | 用鼠标把真实 Widget 连续拖到 437×386、320×240 并重启恢复 | 属于 A03 桌面/窗口组合；阶段 1 精确几何仍失败。没有真实 GUI 操作与测量就记 `NOT_RUN`，不能用 `setBounds` 或截图替代 |
| S3-M03 | 100%/150%/200% DPI 的字体、点击命中和四尺寸截图 | 当前只已知本机 150%；未具备其他配置时相应组合 `NOT_RUN`，不得从 CSS 推测通过 |
| S3-M04 | Win+D、普通窗口覆盖、任务栏/Alt+Tab、非抢焦点 | 阶段 1 门槛，阶段 3 不重复宣称；未实际操作则 `NOT_RUN` |
| S3-M05 | Windows 屏幕阅读器/高对比度/减少动画组合 | 有授权和工具时人工执行；否则逐项 `NOT_RUN`。键盘 tab 顺序与可访问名称仍应自动检查 |
| S3-M06 | 真实中文输入法候选确认与 Ctrl+Enter | 属于阶段 4；本阶段只验证中文内容显示和基础 Capture 布局，IME 行为保持 `NOT_RUN` |

## 7. 不得降低的断言

1. “重启仍在”必须关闭第一个 Electron 进程及数据库连接，再启动第二个进程使用同一隔离 userData；刷新页面或重建 React 组件不算重启。
2. 中文任务必须经真实 preload/IPC 写入 SQLite，并从第二进程读取；fixture、mock、localStorage、直接静态卡片都不算。
3. 昨日任务前后必须精确比较 `planDate` 和 `dueDate`；仅断言标题仍可见不足以证明没有自动改期。
4. 完成后重开必须同时断言当前状态、历史中的完成/重开两条操作及稳定 sequence；不得通过清空历史让列表看起来正确。
5. 跨午夜日程在两日各恰好一次、相邻日期为零；不能把断言降为“至少某天可见”。全天结束日必须排除。
6. 保存失败必须是真实主进程存储失败，失败后 DB、operation、receipt、change 均无新增，UI 输入/草稿保留；返回验证错误或 renderer mock 不能替代。
7. 320×240 必须对四个核心入口做可见、可聚焦或可点击断言，并检查无水平溢出；不能只比较截图文件存在。
8. renderer Node 隔离须在三个窗口逐一检查，并对 preload API 使用精确 allowlist；不能只断言 `nodeIntegration: false` 配置文本存在。
9. 视觉状态只有逐图查看并留下结论才可 `PASS`；截图生成成功、DOM 快照通过或浏览器预览都不是视觉验收。
10. 不因测试失败删除用例、扩大超时掩盖竞态、降低条目数、放宽精确日期边界、关闭 sandbox，或把失败场景改成 mock。
11. 环境不具备时使用 `NOT_RUN` 或 `BLOCKED`，不得使用“预计通过”。测试自身断言失败使用 `FAIL`，不能标成环境阻塞。

## 8. 阶段 3 最低通过门槛与报告格式

阶段 3 结束前至少需要：

- S3-D01 至 D12 全部自动 `PASS`。
- S3-E01 至 E11 在真实 Electron 中 `PASS`；至少有一个独立第二进程恢复证据。
- 24 张基础矩阵及状态扩展截图已实际检查，逐图清单无未处置的阻塞缺陷。
- A07、A08、A14、A15 的阶段 3 范围有可追溯证据；A09/A10 若 Daily Log 尚未实现，只能报告实体、操作快照和当前自动派生范围，完整验收仍保持 `NOT_RUN`。
- `npm run check`、Data 测试、`npm run test:integration`、`npm run test:e2e` 的实际命令、退出码、平台、版本和证据路径写入 `docs/PROGRESS.md`；任何未执行项单列。

阶段报告对每个用例只使用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`，并记录：测试 ID、命令或人工步骤、实际环境、隔离数据目录、结果、截图/日志路径、关联缺陷。平台测试现存的几何 `FAIL` 必须继续单独报告，不能被阶段 3 业务通过覆盖。

## 9. 本次 QA 设计任务的实际结果

- `PASS`：完整阅读指定约束、阶段 2 契约/进度和当前五个测试文件，完成独立测试设计。
- 修改文件：仅 `docs/reviews/stage3-test-plan.md`。
- 接口变化：无；依赖变化：无；生产代码变化：无。
- 阶段 3 自动测试、Electron 测试、截图生成和视觉检查：`NOT_RUN`，因为本任务范围是测试计划且阶段 3 实现尚未落地。
- Git 检查、提交和推送：`NOT_RUN`；本任务明确禁止 Git 操作。

## 10. STAGE3-QA-IMPLEMENT 实际结果

### 10.1 自动化文件与固定测试钩子

- `tests/e2e/stage3-harness.mjs`：真实 Electron 启动、三窗口发现、隔离 userData、安全 allowlist、受限 preload 调用、change probe、内容尺寸和核心入口可见性检查。
- `tests/e2e/stage3-business.mjs`：实现 S3-E01 至 E11 的可执行主链，包括三次独立 Electron 进程、中文长文本任务、完成历史、重开、昨日日期不变、跨午夜与全天日程、跨窗口事件、真实 SQLite 写锁失败、压力数据及四尺寸布局。
- `tests/e2e/stage3-visual.mjs`：使用真实 IPC 写入基础数据，生成 4 尺寸 × 3 主题 × 2 语言的 24 张 Widget PNG，并逐张记录 SHA-256、DIP/content bounds、像素尺寸、locale/theme/resolvedTheme 和 `inspectionStatus=NOT_RUN`。

自动化依赖下列 renderer 测试钩子；它们来自当前 UI 实现或语义 HTML，不要求 renderer 暴露调试 API：

- 当前待办：`section[aria-labelledby="current-tasks-heading"]`
- 今日安排：`section[aria-labelledby="today-schedule-heading"]`
- 最近笔记：`section[aria-labelledby="recent-notes-heading"]`
- 捕获入口：`[data-testid="open-capture"]`
- 日期入口：`[data-testid="widget-date"]`
- 已完成折叠：`[data-testid="completed-today-toggle"]`
- 主题状态：`html[data-theme][data-theme-preference]`；语言使用 `html[lang]`

### 10.2 已执行命令

| 命令 | 状态 | 实际结果 |
| --- | --- | --- |
| `node --check tests/e2e/stage3-harness.mjs` 及两个执行脚本 | PASS | 三个 `.mjs` 均通过 Node 语法检查 |
| 第一次 `npm run build` | FAIL | 并行 UI 工作区当时已引用但尚未落盘 `src/renderer/src/LibraryView.tsx`；Rollup 报无法解析 `./LibraryView`。QA 未修改生产代码 |
| 第二次 `npm run build` | PASS | `LibraryView.tsx` 落盘后，main、preload、三个 renderer 入口全部构建成功 |
| `node tests/e2e/stage3-business.mjs` | FAIL | 真实 Electron 启动、三个 renderer 安全 allowlist 与安全首选项先通过；随后 bootstrap capability 门槛发现 20 个 v2 handler 未集成并非零退出。未进入业务 mutation，未使用 mock |
| `node tests/e2e/stage3-visual.mjs` | FAIL | 非零退出；缺少 `widget.getSnapshot`、`tasks.create`、`tasks.setCompletion`、`schedules.create`、`settings.updateAppearance` handler；生成 0/24 张截图，manifest 明确记录 `generationStatus=FAIL`、`visualInspectionStatus=NOT_RUN` |

最终复核运行的视觉失败 manifest 位于被 Git 忽略的 `test-results/stage3/2026-09-21T08-51-47-055Z-43301398/manifest.json`。它记录 Electron/Node/SQLite 版本、0/24 截图、失败原因和 `visualInspectionStatus=NOT_RUN`；这是本地运行证据，不是待提交源码，其中的隔离 userData 已由 harness 安全清理。

### 10.3 当前判定与 Lead 集成入口

- 三窗口 renderer Node 全局隔离、contract v2 preload 精确 allowlist、`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`：`PASS`（业务脚本在 capability 失败前已逐窗执行）。
- contract v2 handler 集成：`FAIL`。当前 bootstrap 只报告 `app.bootstrap`、`notes.create`、`notes.get`、`changes.subscribe`；业务脚本列出的其余 20 个能力均缺失。
- 中文任务、完整进程重启、完成历史、重开、昨日不改期、跨午夜/全天双日、跨窗业务刷新、空状态、大量条目、长文本和四尺寸业务断言：`NOT_RUN`，因为测试在 handler 门槛停止。
- SQLite 写锁保存失败与释放后重试：代码已实现，但没有越过 handler 门槛，状态为 `NOT_RUN`。该测试只覆盖真实 IPC 事务回滚和事件边界；Capture 输入保留仍需在 Lead 接好 handler 后补充 UI 触发链，当前不宣称通过。
- 视觉截图生成：`FAIL`（0/24）；视觉逐图检查：`NOT_RUN`。没有把失败 manifest 或空截图目录写成视觉通过。
- Git 检查、提交和推送：`NOT_RUN`；`STAGE3-QA-IMPLEMENT` 明确禁止 QA 执行 Git。

Lead 接入 Data 服务与全部 v2 IPC handler 后，先执行 `npm run build`，再串行执行：

```text
node tests/e2e/stage3-business.mjs
node tests/e2e/stage3-visual.mjs
```

视觉脚本成功只代表 24 张图生成完毕。Lead 仍须用图像工具逐张打开检查，并另外写入视觉审查记录，才能更新 `visualInspectionStatus`。

## 11. Lead 集成后的最终复核

本节保留第 10 节的首次失败作为真实过程证据，并记录 Lead 完成 IPC/Data/UI 接线后的最终状态；不是覆盖或改写早期结果。

| 检查 | 状态 | 最终证据 |
| --- | --- | --- |
| S3-D01 至 S3-D12 | PASS | `npx vitest run tests/data` 退出 0，2 个文件、19/19；覆盖事务、幂等、乐观 revision、日期查询、操作快照、草稿、回收站和永久删除 |
| S3-E01 至 S3-E11 | PASS | `npm run test:e2e` 最终退出 0；三次独立 Electron 进程，中文任务跨进程恢复、完成/重开历史、昨日不改期、跨午夜/全天双日、跨窗口事件、真实写锁回滚和压力布局通过 |
| Electron 存储烟雾 | PASS | `npm run test:integration` 退出 0；Electron 44.4.3、Node 24.21.0、SQLite 3.53.4，独立进程关闭重开读回 |
| 三窗口安全边界 | PASS | Widget/Capture/Library 均为 `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`；renderer 中 `process/require/Buffer/module` 不可用，preload API 与 v2 allowlist 精确一致 |
| 基础视觉矩阵生成 | PASS | `test-results/stage3/2026-09-21T09-19-37-659Z-b79cf055/manifest.json` 记录 24/24 PNG、150% scaleFactor、四种 DIP 尺寸、三主题、两语言和 SHA-256 |
| 基础视觉矩阵逐图检查 | PASS | Lead 使用图像查看工具打开全部 24 张；同目录 `visual-review.md` 和 manifest 中 24 项均为 PASS。无水平溢出，四个核心区和捕获入口在最小尺寸可发现，主题与中英文可读 |
| 保存失败事务边界 | PASS | 真实 SQLite 写锁导致 mutation 失败；实体、operation、receipt、change 均未新增，未广播事件；释放锁后同路径重试成功 |
| 保存失败后的 Capture 可见输入 | NOT_RUN | 上一项只证明主进程/SQLite 边界；没有从 Capture 表单触发并保存“错误提示 + 输入保留”截图，不扩大结论 |
| 扩展状态截图 | NOT_RUN | Capture/Library 空状态、保存失败、键盘焦点、已完成展开态及 100%/200% DPI 的扩展截图未全部生成和逐图检查 |
| Windows 系统/桌面人工项 S3-M01 至 M06 | NOT_RUN | 未改变用户系统主题、DPI 或 Explorer，也未发送 Win+D、执行真实鼠标连续缩放或中文 IME 候选确认 |

压力运行实际写入 160 个任务（40 个完成、120 个当前压力任务）、60 个日程和 40 个笔记。请求 320×240 时当前 150% Windows 缩放下得到 320×241 内容尺寸；测试仅允许并记录 1 DIP 平台舍入，超过 1 DIP 会失败。这一 renderer 证据不取消阶段 1 桌面窗口精确几何的 `FAIL`。

最终业务 run 中出现过一次压力播种期间页面意外关闭，状态为 `FAIL`；没有通过放宽断言处理。之后完整 `npm run test:e2e` 重跑为 `PASS`。最终 visual run 的 24 张图均来自真实 preload/IPC/SQLite 数据，不是 fixture、mock、localStorage 或静态卡片。
