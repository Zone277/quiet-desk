# QuietDesk 公共契约

> 冻结日期：2026-09-21；契约版本：1。本文固定进程边界、时间语义和阶段 2 的最小可执行接口。数据库实现细节可以迁移，但不得改变这里的可观察语义而不升级契约版本。

> 阶段 3 扩展冻结日期：2026-09-21；当前 IPC 契约版本：2。下文第 10 节是兼容以上语义的增量冻结，版本 1 的时间、历史、删除和草稿事务规则继续有效。

## 1. 所有权与边界

| 范围 | 所有者 | 约束 |
| --- | --- | --- |
| `src/shared/**`、`src/preload/**`、`src/main/ipc/**` | Lead | 公共类型、运行时 schema、channel、错误和 renderer API 只在此定义 |
| `src/domain/**`、`src/main/data/**`、`src/main/services/**` | Data | 只能实现冻结契约；需要变更时先交回 Lead |
| `src/renderer/**` | UI | 只能经 `window.quietDesk` 和阶段 1 的桌面诊断 API 访问主进程 |
| `src/main/windows/**`、`src/main/platform/**`、`native/**` | Desktop | 阶段 1 `DesktopHostAdapter` 是唯一 Widget 桌面宿主边界 |

Renderer 不得导入 Electron、Node、SQLite、原始 SQL、任意文件路径或 shell。Preload 不提供通用 `invoke(channel)` / `on(channel)`，只映射本文列出的能力。所有业务 payload 由主进程以 `src/shared` 的 schema 再校验；TypeScript 类型不替代运行时校验。

## 2. 时间契约

- `UtcInstant` 是规范 UTC 字符串 `YYYY-MM-DDTHH:mm:ss.sssZ`，用于创建、更新、完成、删除、定时日程和操作发生时间。
- `DateOnly` 是经日历校验的 `YYYY-MM-DD`，用于任务计划日、截止日、全天日程边界和日志归属日；不得先转成 UTC 午夜保存。
- 应用时区是持久化的 IANA 时区。首次安装可以读取系统时区，之后系统时区变化不得静默改写应用时区。
- 历史操作同时保存发生时的 UTC 时间、当时的应用时区和由二者计算的归属日期。日后改变应用时区不重新归类既有历史。
- 定时日程使用 UTC 半开区间 `[startAtUtc, endAtUtc)`；按某日查询时，先用该日和应用时区计算 UTC 边界，再做区间重叠。
- 全天日程使用 date-only 半开区间 `[startDate, endDateExclusive)`。两类结束值都必须严格晚于开始值，不能混用字段。
- 业务服务只依赖可注入 `Clock`；测试使用 `FixedClock`，不修改系统时间，也不真实等待跨日。

## 3. 最小实体约束

- Task：非空标题、Markdown 说明、相互独立的可空 `planDate` / `dueDate` / `completedAtUtc`，以及创建、更新、软删除时间。
- Note：允许空标题，Markdown 正文，以及创建、更新、软删除时间。
- Schedule：`timed` 与 `all-day` 判别联合；禁止同时携带另一类的时间字段。
- Draft：捕获类型、经过对应命令 schema 校验的 payload、单调递增 revision 和已落盘时间。旧 revision 不得覆盖新 revision。
- Daily Log：归属日期、生成时区、生成版本、自动条目和独立手写 Markdown。每个自动条目保留源实体和必要操作关联，不把整份日志压成不可追踪字符串。

任务的计划日不等于截止日；完成不会自动改变任一日期。昨日未完成任务在当前查询继续可见，但原计划日保持不变。过去日程不能因时间已过而自动标记为参加。

## 4. 历史与 Daily Log 规则

- 操作历史是支持产品语义的轻量记录，不是完整事件溯源系统。每条操作具有稳定递增序号；相同 UTC 时间按该序号稳定排序。
- 同一归属日内先完成再重新打开任务：历史区保留“完成”和“重新打开”两条操作；该日自动区的“当天完成”在日界线最终状态下排除该任务。重新打开不能抹去曾发生的两条历史事实。
- 日界线仍待办、当日计划和当日笔记按该归属日的确定状态生成。历史日期一旦越过日界线，后续操作不反向改写当时最终状态。
- 补生成和重复生成以日志日期、区段、源实体/操作的唯一键幂等；只替换自动区，不覆盖 `manualMarkdown`。

## 5. 删除传播

- 删除首先设置软删除时间并进入可恢复回收站。软删除实体从普通列表、搜索、Widget、自动日志和新的导出中隐藏。
- 恢复清除软删除标记，并可依据保留的操作关系重新生成自动日志。
- 永久删除必须有明确确认；在一个事务中逻辑清除实体正文、该实体的应用管理操作快照、自动日志条目和派生缓存。
- 永久删除不扫描或改写 Daily Log 手写区，不追踪已导出文件、手动备份或其他外部副本，也不宣称物理取证级擦除。

## 6. 草稿提交事务

草稿自动保存使用 `expectedRevision`，成功后 revision 递增；版本冲突返回 `CONFLICT`。正式提交必须带 UUID `idempotencyKey`，并在一个 SQLite 事务中完成：

1. 校验草稿 revision 与目标实体命令；
2. 创建目标实体；
3. 写入必要操作历史和幂等回执；
4. 删除已提交草稿；
5. 提交事务。

事务失败全部回滚并保留草稿。重复使用同一幂等键和同一命令返回原结果，不再创建实体；同一键对应不同命令返回 `CONFLICT`。跨窗口变更事件只能在事务提交后发送；窗口收起和输入清空只能在成功结果后发生。

## 7. 阶段 2 IPC v1

每个请求含 UUID `requestId`；改变状态的请求另含 UUID `idempotencyKey`。响应始终为判别联合：

```ts
{ ok: true, requestId, value }
{ ok: false, requestId, error: { code, message, retryable, details? } }
```

错误码固定为 `INVALID_REQUEST`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`STORAGE_ERROR`、`NOT_IMPLEMENTED`、`INTERNAL_ERROR`。预期输入或存储错误不得通过 rejected Promise 或主进程堆栈泄漏给 renderer。

阶段 2 实际暴露的 `window.quietDesk` 能力：

| Preload 方法 | IPC channel | 状态与语义 |
| --- | --- | --- |
| `app.bootstrap(request)` | `quietdesk:v1:bootstrap` | 实现；返回窗口身份、语言、主题、应用时区、当前日期、数据 revision 和能力清单 |
| `notes.create(request)` | `quietdesk:v1:notes:create` | 实现；参数化、事务化、幂等创建最小 Note |
| `notes.get(request)` | `quietdesk:v1:notes:get` | 实现；按 ID 读取；不存在返回 `NOT_FOUND` |
| `changes.subscribe(listener)` | `quietdesk:v1:changed` | 实现；返回幂等取消函数，只接收校验成功的提交后失效事件 |

阶段 1 的 `quietDeskDesktopSpike.getStatus/retryHost` 暂保留给 Widget 诊断，不扩展成业务通道。

事件只含 `eventId`、单调 `sequence`、UTC 发生时间、受影响 topic 和实体引用，不广播正文。Renderer 挂载时先订阅，再读取带 `dataRevision` 的快照；发现更高 sequence 时重取相关快照。重载后重新订阅和全量读取，卸载时必须取消。

主进程按已登记的 `webContents` 和窗口身份授权：三个窗口可以 bootstrap/读取/订阅；阶段 2 的 Note 创建用于 SQLite 烟雾与后续 Capture 接线。非法来源或窗口身份不匹配返回 `FORBIDDEN`。

## 8. 已冻结、后续实现的能力

后续阶段必须沿用以上实体和语义，再逐项扩充窄接口：任务创建/更新/完成/重开和当前查询；笔记编辑；日程创建及按日重叠查询；带 revision 的草稿保存/提交；日期视图、Daily Log、回收站/恢复/永久删除、时区设置和 Markdown 导出。

这些能力在阶段 2 不出现在 preload 表面，也不由空壳返回虚构数据。Markdown 预览、IME 行为、全局快捷键、完整业务 CRUD、Daily Log 生成与删除传播的端到端行为均为 `NOT_RUN`，分别留给后续阶段。

## 9. 数据目录与 SQLite 门槛

- 正式库：Electron 正式 `userData` 下的应用专属路径。
- 开发库：独立开发 `userData`；不得复用正式库。
- 测试/演示：每次由 harness 显式创建的新临时目录，从 `app.ready` 前设置；不得注入正式目录或在普通启动写 demo 数据。
- schema 迁移使用 `PRAGMA user_version` 顺序执行并在事务中提交。连接启用 foreign keys 和合理 busy timeout；SQL 只允许参数化语句。
- 阶段 2 的原生门槛是在目标 Electron 运行时完成迁移、写入中英文 Note、读取、关闭连接、重新打开同一库再次读回。普通 Node 结果不能替代。
- 原生依赖重建与 Electron 测试串行执行，禁止两个 agent 同时重建同一个 `node_modules`。打包产物中的 SQLite 加载仍由阶段 6 验证；没有运行发布产物时必须标为 `NOT_RUN`。

## 10. 阶段 3 IPC v2 扩展

### 10.1 实体 revision 与冲突

- Task、Note、Timed Schedule、All-day Schedule 均具有从 1 开始的整数 `revision`。创建为 1，每次成功编辑、完成、重开、改期、移入回收站或恢复递增一次。
- 编辑和状态命令必须提供 `expectedRevision`。不匹配返回 `CONFLICT`，不得写实体、历史、change event 或幂等回执。
- 已完成任务再次完成、未完成任务再次重开、回收站实体直接编辑、未进入回收站就永久删除均返回明确错误，不静默成功。
- 每个改变持久化状态的命令继续要求 `idempotencyKey`；同键同命令重放原结果，不增加 revision、历史或 change sequence。

### 10.2 查询由主进程分组

- Widget 使用一个聚合快照：当前待办、目标日重叠日程、最近笔记、当天仍处于完成状态的任务，以及每组真实总数。Renderer 不重新实现日期资格或日程重叠规则。
- 当前待办仅含未删除、未完成，且无计划日或 `planDate <= currentDate` 的任务；昨日任务继续可见但日期字段不改变。未来任务必须有 `planDate > currentDate`。
- Library 日期快照由主进程返回任务的匹配原因、日程重叠结果和当日笔记。定时日程采用 UTC 半开区间与应用时区日界线重叠；全天日程继续使用 date-only 半开区间。
- Widget 快照有条目上限但同时返回真实 totals；空间不足显示准确“还有 N 项”，不能靠隐藏整组功能规避小尺寸。

### 10.3 操作快照、回收站与永久删除

- 除草稿逐字保存外，业务 mutation 在同一事务中写入提交后实体快照、change event 和幂等回执。快照保存发生 UTC、当时应用时区、归属日期、实体 revision 和全局稳定 sequence。
- 移入回收站后普通查询隐藏实体；恢复保持正文、计划日期、截止日期、日程边界和完成状态，不自动改期。
- 永久删除请求必须携带与目标 ID 完全相等的 `confirmedEntityId`，且目标已在回收站。
- 永久删除事务清除实体正文、应用管理的操作快照、自动派生项和关联幂等正文。为阻止旧命令恢复已删除内容，可保留不含正文的最小 tombstone/删除回执。
- 上一条是幂等“同命令返回原结果”的隐私例外：旧回执已去除正文后再次重放返回 `NOT_FOUND` 或 `CONFLICT`，不得重建实体。

### 10.4 草稿与设置

- Draft payload 是 `note`、`task`、`timed-schedule`、`all-day-schedule` 判别联合；`captureKind` 必须与 payload 对应，不能由 renderer 用 `Record<string, unknown>` 猜测。
- 首次保存使用 `expectedRevision=0`，成功得到 revision 1；后续必须精确匹配。草稿保存产生 `drafts` change event，但不进入操作历史。
- locale 固定为 `zh-CN | en-US`，theme 固定为 `system | light | dark`；设置存于 SQLite。Bootstrap 同时返回用户 theme 和当前 `resolvedTheme`。
- 未知系统语言首次启动回退 `en-US`。`system` 的解析由主进程/Electron 提供，renderer 不访问 Node 或 Electron `nativeTheme`。

### 10.5 v2 preload 表面

`window.quietDesk` 只暴露以下命名域和方法：

- `app.bootstrap`
- `widget.getSnapshot`
- `library.getDay/getEntity/getHistory/listTrash`
- `tasks.create/update/setCompletion/reschedule`
- `notes.create/get/update`
- `schedules.create/update`
- `drafts.get/save`
- `entities.trash/restore/permanentlyDelete`
- `settings.updateAppearance`
- `windows.show/hide`
- `changes.subscribe`

仍禁止通用 invoke/on、SQL、任意路径、文件系统和 shell。窗口 show 只允许 Widget 明确唤起 Capture/Library；Capture 隐藏不等于清空草稿。完整快捷捕获提交、Markdown 预览、Daily Log 和导出不属于阶段 3，不得用静态数据伪装完成。
