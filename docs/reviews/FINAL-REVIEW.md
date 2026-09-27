# 阶段 7：独立验收审查

审查基线：`f3f40ec`，Windows x64 Build 22631，Asia/Shanghai。当前交付仍为 **开发预览，桌面验收未完成**。本文是产品验收报告；专门安全审查的规范报告由安全工具生成，不用本文冒充。

## 独立性与职责

使用真实 `multi_agent_v1`，新审查线程均 `fork_context:false`，不继承实现历史、不修改源码、不委派；共享目录不意味着独立副本。最多同时 3 个。Lead 串行执行构建和 GUI 自动化，审查者只能离线读实际源码/测试/已存在产物证据；Data 可运行隔离局部测试。

| 任务 | 实际 agent / ID | 范围与输出 |
| --- | --- | --- |
| 能力前置检查 | Goodall / `01a0e1f4-2ffe-7202-b250-a7bc132aadc0` | helper 实际退出 0 / ready；没有改全局配置；完成后关闭 |
| 数据/历史 | Volta / `01a0e1f5-8d13-7040-a342-c34172890c49` | domain、SQLite、事务、历史、删除、局部测试；只读审查 |
| 桌面/安全 | Erdos / `01a0e1f5-8c22-7411-82f6-f6eb3534611f` | 实际源码的 IPC/Markdown/native/宿主/发布边界；静态审查不是实机验收 |
| 架构及 UI/输入 | Kepler / `01a0e1f5-8e25-7c02-9c66-fd10912a16bc` | 资源消费者和控件/异步输入流程；未参与相应实现 |

实现 owner 与只读审查者分别负责修复和复核，公共类型/IPC/依赖仍由 Lead 统一拥有。独立指本轮创建的新线程和不继承实现上下文，不宣称不同模型、人类或物理隔离。

## 可重现演示

自动闭环（不是普通启动的 demo 注入）：

```powershell
npm run build
node tests/e2e/stage7-demo.mjs
```

脚本经真实 preload/IPC/SQLite 创建 A=2026-09-21 的任务（计划 A、截止 B）、B=2026-09-22 23:30 至 C 00:30 的日程及中英文 Markdown 笔记；关闭并重新启动 Electron，注入 B 日 Clock，验证日期、正文与两天日程重叠，完成昨日任务，查看 A 待办/B 完成；删除隐藏、恢复重建、导出；再重启注入 C 日，复核旧日，明确确认永久删除且手写保留、独立旧导出不改变。系统时间没有修改。

输出 `STAGE7_DEMO_PASS <路径>`；该路径下 `report.json`、`独立 数据/data/quietdesk.sqlite3`、`中文 导出.md`、`删除后 导出.md` 与截图被保留且 Git ignored，不访问正式数据。导出自动测试替换原生 dialog 返回值，不能算真实保存对话框通过；原生保存对话框证据单列阶段 6。

人工查看和真实桌面后续检查：先关闭自动脚本的进程，在新 PowerShell 中把上面实际输出的绝对路径填入 `$demoRoot`，不能指向正式 userData。

```powershell
$demoRoot = '填写 STAGE7_DEMO_PASS 的绝对路径'
$env:QUIETDESK_TEST_USER_DATA = Join-Path $demoRoot '独立 数据'
$env:QUIETDESK_TEST_TIME_ZONE = 'Asia/Shanghai'
$env:QUIETDESK_TEST_NOW = '2026-09-23T04:00:00.000Z'
Remove-Item Env:QUIETDESK_FORCE_FALLBACK -ErrorAction SilentlyContinue
& .\node_modules\.bin\electron.cmd .
```

在 Widget 日期入口/托盘打开 Library，选择 A/B/C 日；任务已永久删除，手写与笔记仍在，可比对删除前后 Markdown。想重新观看完成/恢复过程，重新运行演示会新建独立目录，不覆盖旧数据。手动在同一隔离环境用 Capture 创建自己的任务后用界面操作，不使用开发者脚本宣称 UI 流程已验收。

桌面检查必须实际操作并观察：确认诊断为 native WorkerW/Progman 挂接而非 fallback，先让桌面露出，按 **Win+D**、打开普通应用覆盖 Widget、再返回桌面；观察组件可见且不置顶，任务栏/Alt+Tab 与前台焦点；鼠标从 480×420 连续拖到非预设 437×386 和 320×240，点击捕获/日期/完成按钮确认命中，再退出重启比较位置尺寸。截图/录屏同时记录 Windows build、DPI、显示器和 native 诊断。本文没有执行这些手动步骤，因此均为 NOT_RUN，桌面总门槛 BLOCKED。

Explorer 重启、睡眠、多屏拔插、系统 DPI 改变仅在明确授权测试环境执行；没有授权就不执行。这里不绕过 Windows 键输入限制、不重启 Explorer、不改登录启动或用户网络。

## 命令与证据

由 `node scripts/stage7-verify.mjs` 串行收集实际命令、起止时间、退出码、环境与日志，每轮使用新目录 `test-results/stage7/commands-<timestamp>/`，不覆盖失败记录。PASS 只覆盖对应断言；所有真实 Shell/IME/物理断网等未执行范围单列。

最终运行（含所有生产修复）`commands-1790500222655/results.json`：22条均退出0、runner退出0；`--supplement` 对应 `commands-1790500577075/results.json`：7条均退出0。环境Windows11 x64 Build22631、host Node22.13.1/npm10.9.2、Electron44.4.3/内置Node24.21/SQLite3.53.4。不是浏览器网页预览；实际Electron窗口/SQLite与真实exe均已启动。人工桌面动作未执行，不将GUI存在解释为Win+D通过。

| 实际核心命令 | 退出状态 | 最终日志 |
| --- | --- | --- |
| npm run check | PASS / 0，17契约+类型 | 01.log |
| npm run test:integration | PASS / 0，Electron真实存储重启 | 05.log |
| npm run test:e2e | PASS / 0，业务/捕获/历史/生命周期 | 06.log |
| npm run build | PASS / 0 | 02/17.log |
| npm run dist:win | PASS / 0 | 18.log |
| npx vitest run tests/data tests/platform | PASS / 0，81 | 03.log |
| renderer vitest | PASS / 0，29 | 04.log |
| 当前发布IPC / SQLite与portable | PASS / 0 | 19–21.log |
| 新回归与演示 | PASS / 0 | 07–16.log；补充01–07.log |

最终portable `release/QuietDesk 0.1.0.exe` SHA256 `2E839917F1489B3EB60D06FD23439E4E6A201F3D7A8BD46FC30DF09CEF404104`；也可运行 `release/win-unpacked/QuietDesk.exe`。当前正式入口使用本地静态file资源，不读取开发URL；测试均从独立目录，不改正式数据。最新严格正常退出的三天演示为 `test-results/stage7/演示 空格 1790500588701/`，用开头脚本可另建一套完整复现。

发布实测 `发布 验证 1790500222656/report.json`：两进程23804/19636，启动到三窗ready约2036/1857ms；六进程总工作集657.79–666.54MB，Electron CPU合计字段0.0094–0.0604%。AMD Ryzen7 7735H/16逻辑CPU/15.24GB可见RAM；5秒settle+6×1秒，另按Get-Process路径前缀做工作集/累计CPU差量（100%=一核）。共享页可能重复计数，短命helper可能在采样间隔之外，非峰值、长期泄漏或所有配置承诺。主屏150%+次屏100%是枚举事实，不是切屏支持验收。网络阻断仅Chromium harness层，物理断网NOT_RUN。

## 问题、修复与追踪

审查发现按产品交付严重度分级，不把普通正确性问题写成安全漏洞。下表位置指审查基线符号/行（修复后行号可能变化）；静态问题与真实失败证据分开，最终修复状态另列。重叠的跨日/编辑问题合并，没有用 reviewer 的“完成”代替 Lead 复核。

| ID / 严重度 | 位置 | 最小触发、预期 → 基线实际 | 初始证据 / 最小 owner 范围 |
| --- | --- | --- | --- |
| D01 / P2 | `quietdesk-database.ts:138`、`saveDraft` | 合法百万字符正文/转义字符；完整草稿 → JSON 整体超过百万 CHECK | Data 只读发现，原 owner 后补 5 项 SQLite 红灯；Data 追加迁移 |
| D02 / P2 | `quietdesk-database.ts:155`、`recordHistory` | 百万引号/控制字符实体；历史与实体一起保存 → JSON 膨胀超过两百万回滚 | 原 owner 真实 CHECK 红灯；Data 追加迁移，不扩大输入上限 |
| R01 / P2 | `App.tsx:51`、`WidgetView.tsx:89`、main resume | 常驻跨日无操作；自动今日数据 → 没有失效通知 | Lead 真实 Electron `stage7-runtime-refresh` 超时退出 1；Lead runtime 通知＋UI 重取 |
| U01 / P1 | `LibraryView.tsx:65/99`、`EntityBody` | 选择已存实体；修改源码/改期/旧任务重开 → 只读 pre 与删除按钮 | Lead `stage7-editor` 缺入口断言退出 1；原 UI owner 复用已有 API |
| Q01 / P1 | `CaptureView.tsx:310`、main before-quit、Capture dispose | 去抖前退出；最新输入落盘或取消退出 → destroy 丢最后输入 | Lead 真实 Electron `stage7-quit-draft` 退出 1；Lead 窄化退出准备＋UI flush |
| H01 / P2 | `HostBadge.tsx:22`、controller emitStatus | 挂接后自动恢复失败；显示 fallback → 只首次读徽标 | 独立 Erdos 静态链，真实失效 GUI NOT_RUN；UI 只读低频刷新 |
| R02 / P2 | main resolvedTheme、`App.tsx:62` | system 模式 OS 外观切换；主动跟随 → 没有 updated 接线 | 独立静态确认；Lead/nativeTheme 通知＋UI；真实 OS 切换 NOT_RUN |
| U02 / P1 | `CaptureView.tsx:182/248/317` | r1 read 延迟、r2 edit/save 后旧 read 返回；保留新输入 → dirty=false 后旧响应可重置表单 | 独立 Kepler 条件竞态静态链，初审运行 NOT_RUN；UI 编辑 epoch/读失效 |
| U03 / P2 | `CaptureView.tsx:344/358` | Esc 隐藏保存 pending 时 Ctrl+Enter；互斥 → 两分支可能并行，失败可能隐藏 | 条件竞态静态链；UI 隐藏/提交互斥，不能误称数据库丢失 |
| U04 / P2 | `LibraryView.tsx:186/199` | 快速 A→B 或切模式，A 后返回；保持最后选择 → 旧响应可回填 | 条件竞态静态链；UI generation 约束详情/历史/错误/清空 |
| U05 / P2 | `LibraryView.tsx:156` | 跨窗更新/回收当前详情；刷新或清空 → 仅列表刷新、旧正文仍可见 | 静态缓存失效缺口；UI selected refs 同步，不声称 DB 正文被恢复 |
| U06 / P3 | `CaptureView.tsx:498`、model markdown 限额 | 超过百万正文；明确超限可缩减 → 先接受后只得到通用校验失败 | 静态界面边界；UI 明确提示，不能静默截断或改后端限额 |
| U07 / P2 | `styles.css:1501`、Widget 日程 meta | 320×240 日程标题无时间；自然看到安排 → 唯一时间被 CSS 隐藏 | 静态样式链；UI 保留紧凑时间/明确详情；视觉另验 |
| W01 / P2 | `restoreExactBounds`、helper resize | 150% 恢复437×386；精确恢复 → 实际436宽、helper拒绝 | Lead两次实机 FAIL；Desktop现场argv **-229/-198** 超过±64，并非陈旧构建；原 Desktop owner 分段有限修正、不重放已完成 native 进度 |
| W02 / P3 | native `TryParseResizeDeltas` | 进程 culture 自定义符号；固定十进制参数 → 受 CurrentCulture 解析影响 | 补充 headless C# 175 cases /18红灯→0失败；不冒称当前zh-CN现场根因；InvariantCulture＋仍保留±64与PID检查 |
| Q02 / P2 | preload quit listeners（Lead 初稿） | 同窗多个待保存组件；全部成功才确认 → 各自回执可能先true后false | Lead `preload-quit` 实际红灯两次ACK；聚合单窗口一次 all-success 回执，独立复核另列 |
| Q03 / P1 | Capture prepareQuit返回、DailyLog/EntityEditor、main waiting | Capture已ready而Library延迟；禁止新编辑直到退出 → 首轮修复提前解锁 | Erdos独立复审；Lead真实 `stage7-quit-freeze` 退出1（实际Capture ACK后disabled=false）；原UI owner持续锁，Lead按nonce取消和整窗inert，不放松断言 |
| U08 / P2 | styles小尺寸schedule-time/item-list | 320×240日程时间恢复显示后仍需完整可读 → overflow裁切第二行 | Lead逐张查看当前6张Widget截图后发现；真实small-time回归退出1：time.bottom150.17 > list.bottom145.26。UI仅改小尺寸同行布局，不移除时间/入口 |

安全审查基线 46 个 src 文件没有报告已验证现实攻击链漏洞；这不是“绝对安全”或所有运行时安全组合 PASS。子 frame、发布 CSP 的开发 WebSocket 许可、Widget 导航策略等列为有反证的防御加强/未验证问题，不扩成无关重构、不虚构已利用。测试目录覆盖也可影响 packaged 启动，隔离依赖明确传入正确目录，不是操作系统权限隔离。

补充独立复核：Galileo / `01a0e205-639b-76f3-b403-6ad3b191a9a4`（新线程、只读）完整阅读真实preload与聚合契约测试，实际执行contracts 15/15；Erdos随后完整阅读39个修改/相关文件，发现Q03，因此没有因首轮绿灯直接结束。Data/Desktop/UI分别交原owner Mencius/Pasteur/Sartre，Lead处理公共接口与统一复验；不把局部/静态结果计为Lead GUI通过。

首轮失败记录保留：`commands-1790497442150` 的实机restore失败；`commands-1790499091511` 中check、81项Data/platform、26项组件、Electron integration、完整E2E、跨日演示、编辑、失败退出重试和三项读取竞态均退出0，但17–19发布测试因Lead runner的cmd/CRT双重参数转义，在产物启动前退出1。该项是harness FAIL，不是发布成功或已复现产品故障。已改Node直接argv，另跑最新产物。reading-race capture初次误传locale `en`被真实schema拒绝，修为 `en-US`后才得到旧正文覆盖的产品RED；不混淆失败性质。

## 需求 → 实现 → 证据 → 状态

实现位置均为真实源码，`Data` 简写 `src/main/services/core-data-service.ts`；`Renderer` 简写 `src/renderer/src/`。下表判断完整验收情境；自动子项PASS不能替代未执行的人工部分。没有本轮人工PASS冒充自动化结果。

表内 `platform/`、`windows/` 为 `src/main/` 下路径；该追踪矩阵不是只依据进度声明生成。

| ID / 需求 | 实现位置 | 实际测试/人工证据与范围 | 状态 |
| --- | --- | --- | --- |
| A01 桌面/Win+D/覆盖 | `platform/desktop-host.ts`、native helper、`windows/desktop-spike-window.ts` | 当前Windows原生父句柄inspect PASS；Win+D、覆盖/自然露出 NOT_RUN，核心桌面门槛 | BLOCKED |
| A02 无任务条目/不抢焦点 | Desktop controller窗口选项、showInactive | 平台诊断focused=false和非置顶配置PASS；任务栏/Alt+Tab/瞬时前台观察NOT_RUN | NOT_RUN |
| A03 自由缩放/入口/恢复 | Desktop restoreExactBounds、Renderer Widget/styles | 437×386恢复两次及默认几何自动PASS；320布局回归；真实鼠标连续缩放/拖动NOT_RUN | NOT_RUN |
| A04 DPI/显示器变化 | Desktop clamp/显示器事件 | 主屏150%自动PASS；发布诊断枚举主屏150%+次屏100%；100%目标落屏/200%/跨屏/移除实际操作NOT_RUN | NOT_RUN |
| A05 Shell/休眠恢复 | Desktop attach/inspect/retry、Main resume | 生命周期unit和应用resume事件probePASS；无授权Explorer重启/真实睡眠NOT_RUN | NOT_RUN |
| A06 双语/主题/可读性 | Renderer i18n、tokens、AppearanceControls、App runtime | 双语主题静态/组件及真实截图；实际OS外观切换、辅助技术组合NOT_RUN | NOT_RUN |
| A07 昨日不自动改期 | Data getWidgetSnapshot/getDayView | stage3 business、stage7 demo A/B/C、runtime刷新；真实SQLite/多个进程 | PASS |
| A08 完成/重开/长期历史 | Data setTaskCompletion/getHistory、Library reopen | stage3 business、stage7 editor历史UI重开和重启读取 | PASS |
| A09 删除/恢复日志传播 | Data trashEntity/restoreEntity/generate | Data局部SQLite、stage5 daily-log、stage7 demo和跨窗reader清空 | PASS |
| A10 永删关联正文 | Data permanentlyDeleteEntity/日志结构关联 | 三实体删除链SQLite测试、stage5重启、stage7永久确认/手写/独立副本断言；逻辑清理不是物理擦除 | PASS |
| A11 捕获/多行/IME | CaptureView composition/key handlers、transaction submit | 实际Electron多行/中英/显式类型/DOMcomposition PASS；阶段6有旧版原生IME证据，最新修复分支真实候选确认NOT_RUN | NOT_RUN |
| A12 草稿/失败/退出 | CaptureView、Data saveDraft/submitDraft、quit-preparation | stage4 capture、真实SQLite Library写失败取消/重试、去抖前quit读库；不承诺强制终止零损失 | PASS |
| A13 乱序保存/读取 | Capture generation/editEpoch、Data revision | stage7 reading-race capture真实延迟服务响应；局部冲突/幂等事务回归 | PASS |
| A14 跨窗口一致 | IPC broadcast、change subscriptions、Library invalidation | stage6 lifecycle 100 disposer/重载、stage7 reading-race delete/order；真实窗口/数据库 | PASS |
| A15 午夜/全天重叠 | Data getDayView、domain date overlap | Data固定时区/DST/边界、stage3和stage7 B/C午夜查询 | PASS |
| A16 日期浏览/明确计划 | Widget日期入口、Library、EntityEditor | stage7 editor两类日程真实修改、日期和任务改期；展示计划不推断参加 | PASS |
| A17 迟看过去状态 | Data操作快照/Daily Log | stage5 A/B/C真实重启、stage7 demo；C改动不改A待办/B完成事实 | PASS |
| A18 四类日志/幂等/手写 | Data getOrGenerateDailyLog/saveDailyLogManual、DailyLogPanel | Data SQLite局部、stage5和stage7 demo；缓存多日期手写退出unit | PASS |
| A19 关机跨日/时区 | Clock、Data reconcileActiveDailyLogs、Main runtime | 多进程固定Clock补生成、时区/DST边界、常驻resume事件probe；不改系统时间 | PASS |
| A20 同日重开事件规则 | Data历史序列、CONTRACTS | stage5真实SQLite完成后重开事件保留、后日标题/改期历史不改写 | PASS |
| A21 Markdown/外链 | MarkdownView skipHtml/img、IPC links + shared URL schema | stage4恶意HTML/远程图/协议拒绝、静态源码审查；只开放正常http/https | PASS |
| A22 IPC/隔离 | shared strict schema、fixed preload、window-registry | 实际sandboxed未登记renderer拒绝/角色拒绝、Node globals absent、contracts；无任意SQL/path接口 | PASS |
| A23 持久化/迁移/无demo | quietdesk-database v5、Main configureUserDataPath | Electron两进程读回、v4真实旧CHECK迁移局部、普通空库业务E2E | PASS |
| A24 发布原生SQLite/helper | Electron内置node:sqlite、builder extraResources | 阶段7发布IPC、中文空格路径两进程SQLite读回/迁移、portable两次实际启动/helper挂接PASS；具体包与日期见最终命令证据 | PASS |
| A25 快捷键/关闭与退出 | GlobalShortcutManager/Capture controller/tray | stage4真实冲突/更改、stage6 resident lifecycle/退出重启；开机项默认关闭且未改用户配置 | PASS |
| A26 UTF-8导出/副本边界 | IPC dialog/writeFile、Data renderDailyLogMarkdown、DailyLogPanel | stage5/stage7真实UTF8与删除前后导出；当前自动化dialog override，阶段6原生dialog证据仅对所测版本 | PASS |
| A27 无dev server/离线/隔离 | Main packaged file入口、独立userData | 静态源码/打包列表PASS；最新Chromium断网发布验证另记；OS物理断网NOT_RUN | NOT_RUN |
| A28 发布性能/监听释放 | runtime/tray/IPC dispose、发布smoke采样 | 实际发布六进程总工作集/CPU和双次启动采样；窗口监听100次清理回归；不声称穷尽泄漏分析 | PASS |

## 剩余限制与交付范围

业务原型不等于桌面产品签核。A01为核心BLOCKED；A02–A06、A11、A27含明确NOT_RUN项。Shell内部窗口结构仍非稳定API；当前不透明窗口，不新增透明效果。未经测试的Windows、DPI、多显示器、输入法组合不得宣称支持。原生窗口恢复的4轮、单轮±64px预算覆盖本次偏差，并非任意配置收敛保证。

SQLite内置原生驱动仍有ExperimentalWarning；构建会出现Zod注释和electron-builder默认图标/重复依赖警告，不能把日志中的signing标签当成可信代码签名。用户正式数据库没有读写。所有生成数据库、截图、导出及日志均在ignored隔离目录，源码提交不携带这些数据。

阶段7安全skill使本轮使用真实配置前检、独立源码审查与规范扫描产物，而非只读进度确认。规范报告由工具生成：`C:/Users/50199/.codex/state/plugins/codex-security/scans/QuietDesk/f3f40ec0984591d0b2d4aa2ddda00f528664ae68_20260927T082111Z_qh1s33sn/report.md`。报告绑定原始f3f40ec，工具明确警告运行期间HEAD改变；当前树补充复核coverage为partial，不可将0报告漏洞扩成最新版完整安全认证。产品缺陷及回归见本文，未写入安全漏洞列表。

视觉证据：Lead实际逐张打开 `stage6-ui/2026-09-27T09-06-31-602Z-24b26430` 的6张小Widget与 `...09-06-36-931Z-4256b19e` 的6张Capture预览；前者导致U08，不记视觉PASS，后者中英/三主题/表格清单可读且长行局部滚动，截图只证明可见视口。Capture尺寸480×420是harness降低窗口最小约束的压力情境，不宣称普通Capture最小尺寸改变。U08修复后的 `stage7/small-time-1790500350318` 四张全天/定时×中英已逐张打开，时间完整显示、标题可省略且所有核心入口保留，局部视觉PASS。`stage7/editor-1790499544880` 的编辑及冲突两图也已打开：输入保留、错误与保存/取消可见，无遮挡；Library-B演示截图已检查当前安排，不把视口外日志算作截图验收。生成manifest仍保持visualInspectionStatus NOT_RUN是生成器事实；本文独立记录实际检查，不篡改自动报告。

所有18项问题的已实现修复以相应局部、真实Electron或原生几何回归证明；H01实际Shell失效恢复、R02实际OS主题、A11新IME等人工执行项仍NOT_RUN，不因源码修复自动升级为场景PASS。退出Q03首个GREEN尝试因harness在应用销毁后才读取app.process()整体退出1；修为启动时捕获同一process对象后补跑退出0，所有锁定及正常退出断言保留。

最终补充7项PASS包括真实Electron百万控制字符（转义六倍）草稿保存→提交事务→历史快照→正常退出→新进程读回，不仅是普通Node单测。最新截图12张（`stage6-ui/2026-09-27T09-16-38-164Z-8a3c04b5` Widget、`...09-16-43-564Z-82a1a63d` Capture）全部逐图打开；小Widget日程时间/核心入口、双语三主题与Capture混排表格可见部分局部视觉PASS。没有把截图外区域或原生窗口覆盖关系算作已验收。
