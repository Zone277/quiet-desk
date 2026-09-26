# Stage 6 独立 QA（2026-09-26）

任务：QA-S6-LIFECYCLE-RELEASE。单个 QA owner；没有创建或冒充子 agent。共享工作目录的基线 HEAD 为 `7170e1d6877b59c96ae8e99eab46cc44079bb83c`，开始时已有 `src/shared/desktop-spike.ts` 的他人修改。Lead/Desktop/UI 在本轮继续写入各自文件，因此本文是审查快照，不是冻结发布版本的签核。

已完整读取 AGENTS、PRODUCT、ACCEPTANCE、PROGRESS、CONTRACTS；以最新用户要求覆盖默认阶段结束规则：QA 不修改全局 PROGRESS/ACCEPTANCE，由 Lead 汇总。仅修改本报告、`tests/e2e/stage6-{runtime,lifecycle,release}.mjs`、`tests/platform/tray.test.ts` 和 `tests/platform/stage6-release-audit.test.mjs`。生产代码、shared、package、lock、Desktop owned 测试均未修改；没有 Git 提交。

当前交付结论：新增运行测试为 **NOT_RUN**，等 Lead 串行执行。产品仍须标注“开发预览，桌面验收未完成”。本轮没有 GUI、IME、Shell、发布运行、性能截图或录屏证据。历史 PASS 引用来自原阶段报告，不能解释为 Stage 6 复测 PASS。

## 测试设计及执行入口

| 文件 / Lead 命令 | 状态 | 断言与证据边界 |
| --- | --- | --- |
| `node tests/e2e/stage6-lifecycle.mjs`（先由 Lead build） | NOT_RUN | 实际三窗口/preload/IPC/SQLite；创建、完成、幂等重放、revision 冲突、回收站/恢复、重开；三窗口收到相同 sequence，Widget/Library DOM 刷新；每窗 100 次重复取消监听，Library 100 次上下文取消、10 次激活、3 次 reload 后再 mutation。三个窗口 close 仅 hide，窗口 ID 不变；app.quit 正常退出、will-quit 时快捷键已释放、数据库 integrity/foreign-key 检查与第二 PID 恢复。输出 `STAGE6_LIFECYCLE_PASS/FAIL`。强制 fallback，不证明桌面驻留 |
| `node tests/e2e/stage6-release.mjs "C:\\...\\release\\win-unpacked\\QuietDesk.exe"` | NOT_RUN | 最终收敛为补充关键 IPC：绝对 exe、`app.isPackaged=true`、隔离 cwd/userData；错窗口身份/跨窗口操作/受限日志权限/任意导出路径/原始 SQL 额外字段/危险 URL/未登记真实 sandboxed webContents 均拒绝，requestId 相关性、不泄露 stack、dataRevision 不变。输出 `STAGE6_RELEASE_IPC_PASS/FAIL`。不重复 Lead smoke 的 SQLite/重启/离线/指标；portable 自解压器由 Lead 测试 |
| `npx vitest run tests/platform/tray.test.ts`（Lead 本地执行） | PASS | Lead 本任务反馈 7/7 及 check 通过；QA 没有自行复跑或获得额外日志文件。mock Electron 的模板/wiring：中英文菜单、显示/隐藏 Widget、Library、设置子菜单、退出路由、checkbox click/禁用保护、dispose 保留外部监听。不证明 Windows 通知区或 OS 登录设置 |
| `node --test tests/platform/stage6-release-audit.test.mjs` | PASS | 本轮 Windows Node v22.13.1 退出 0、4/4；静态矩阵 28 项唯一、三 HTML 的 script/image CSP、本地入口、renderer 禁止 Node/Electron/SQL 导入或 raw HTML、锁定 runtime 依赖、打包 files 和真实脚本检查。字符串检查是审查哨兵，不等价运行时安全证明 |

新增测试没有公共接口变化，不要求新 renderer IPC。只用已有窄 API，以及 Playwright main evaluate 创建测试 probe/观察生命周期。变更计数的 FIFO barrier 是测试进程发送的合法元数据事件（空 entityRefs，不写库）；只用于等待前序消息送达，不计为业务事件，也不作为事务提交的产品证据。正式 mutation 仍经过真实 preload/IPC/SQLite。新增窗口 probe 是未登记的 sandboxed webContents，读取/创建都必须返回 FORBIDDEN；它不属于产品窗口或新功能。

各脚本创建独立 `%TEMP%/quietdesk-stage6-*` 目录；只在拥有的根目录内构造中文/空格子目录。退出失败向上抛出，不吞掉失败后继续清理仍在使用的数据库。保留现场可由 Lead 设置 `QUIETDESK_KEEP_TEST_DATA=1`；日志应放进已忽略的 test-results，不能提交正文、数据库或截图。

## A01–A28 完整证据/缺口矩阵

本表状态表示 **Stage 6 本轮完整情境的验证结果**。未重跑的历史子项只列为已有证据。

| ID | 状态 | 已有证据 / 本轮自动测试路由 | 缺口与 Lead 必需证据 |
| --- | --- | --- | --- |
| A01 | NOT_RUN | PROGRESS Stage1 原生 WorkerW attach/独立 inspect；Desktop owned 平台测试 | 实际 Win+D、普通窗口覆盖与返回桌面，记录 Windows build/宿主模式/父 HWND/录屏。fallback E2E 不覆盖 |
| A02 | NOT_RUN | Stage1 skipTaskbar/非置顶/showInactive；本轮 close/quit 生命周期设计 | 实际任务栏/Alt+Tab、启动/午夜/数据更新前景 HWND 采样，区分主动 Capture 聚焦与被动抢焦点 |
| A03 | NOT_RUN | Stage3 4 尺寸历史证据；Stage6 UI 英文 320 标题换行挤压条目 baseline FAIL（UI/Lead 反馈），CSS 已修但尚待复跑；历史 150% 精确几何 FAIL | Desktop 后串行 targeted 6 screenshots，逐图审查/命令/路径/结果待填；真实连续拖动/重启恢复与透明模式另列，不使用历史视觉 PASS 作当前结论 |
| A04 | NOT_RUN | 历史记录只有 150% 单屏 | 100/150/200%、跨屏/移除显示器、命中和可见区域；缺配置明确写 NOT_RUN |
| A05 | NOT_RUN | DesktopHostAdapter 健康检查/失败降级设计；本轮 quit 等待真实 dispose | 授权环境 Explorer 重启/睡眠唤醒恢复，模式/重试入口/日志；不执行会打断当前用户工作的动作 |
| A06 | NOT_RUN | Stage3 24 图仅为历史；Stage6 英文 320 baseline FAIL，CSS 修复后 targeted 6 图最终证据仍 NOT_RUN；Lead smoke 设置/locale 由各 owner 覆盖 | UI 最终复跑路径/逐图判定待填；生成内容 locale 缺陷由 Data 最小修正后集成。真实系统外观、焦点/a11y/减少动画另需证据，不沿用旧视觉 PASS |
| A07 | NOT_RUN | ACCEPTANCE Stage3 PASS；stage3-business 固定 Clock/昨日/未来资格 | Lead 串行回归原测试并记录当前构建与命令退出码；不能只读历史 PASS |
| A08 | NOT_RUN | ACCEPTANCE Stage3 PASS；本轮 lifecycle 完成/重开/第二 PID | Lead 执行原业务和新增生命周期，确认操作历史与两窗口 DOM/持久状态一致 |
| A09 | NOT_RUN | Stage5 PASS，三类实体自动日志隐藏/恢复；lifecycle Task 广播/刷新 | Lead 回归 stage5-daily-log，覆盖三类实体历史日志；新 Task 测试不能独自替代全项 |
| A10 | NOT_RUN | Stage5 PASS，实体/快照/自动项/回执正文清除 | Lead stage5 复跑、重启及新导出证据；不把逻辑清除描述为物理擦除 |
| A11 | NOT_RUN | ACCEPTANCE Stage4 PASS；真实 IME 历史记录在 PROGRESS Stage4，DOM composition 分开 | 当前构建真实中文 IME 候选确认/Ctrl+Enter 人工回归；Playwright 只能证明 composition 分支 |
| A12 | NOT_RUN | Stage4 草稿失败重试/重复提交/Esc/失焦/多 PID PASS；lifecycle close/hide/quit | Lead 执行 stage4-capture 和当前生命周期；应用退出时尚未落盘输入风险须单列，不宣称绝无丢失 |
| A13 | NOT_RUN | Stage4 单在途/revision/editSeq 与写锁较新编辑历史 PASS | Lead stage4 回归；保存文案必须与实际最新 revision 一致，不能以收到旧回执冒充已保存 |
| A14 | NOT_RUN | 本轮 lifecycle 精确事件数、跨窗序号、创建/完成/恢复/重开 DOM、100 disposer/reload | 执行后才判断；本测试观察行为性监听清理，不声称量化主进程堆/内存泄漏 |
| A15 | NOT_RUN | ACCEPTANCE Stage3 PASS，23:30–00:30/多日全天半开区间 | Lead 原业务固定时区回归；无需改系统时间或真实等待 |
| A16 | NOT_RUN | stage3 未来日期查询/上下文，Stage5 计划区明确计划；历史完整 UI 项 NOT_RUN | 未来/今日往返、跨天创建、过去日程仍为“计划”的可见 UI 证据 |
| A17 | NOT_RUN | Stage5 PASS，A 未完成/B 完成/C 首看 A 快照 | Lead stage5-daily-log 再跑，保留固定 Clock/PID/旧文本断言 |
| A18 | NOT_RUN | Stage5 PASS，四类汇总/手写 revision/幂等/稳定 sequence | Lead 自动回归及 Library 视觉证据；重复刷新不能覆盖手写区 |
| A19 | NOT_RUN | Stage5 PASS，跳日补生成/上海边界/持久时区/DST Data | Lead 固定 Clock 回归，OS resume 仍需人工独立证据；不改系统时间 |
| A20 | NOT_RUN | Stage5 PASS，同日完成重开只列待办、后日编辑不重写旧日志 | Lead 回归历史快照测试；本轮重开测试只补 lifecycle，不替代旧日日志语义 |
| A21 | NOT_RUN | Stage4 PASS，HTML/远程图片/危险 URL；新增静态 CSP/source guard | Lead Markdown Electron 回归并观察网络；静态 scan 不证明实际脚本执行/外链浏览器行为 |
| A22 | NOT_RUN | 原窗口安全/allowlist；新未登记真实 webContents probe FORBIDDEN 设计 | Lead lifecycle 和原 schema 负向回归；嵌入子 frame 的 senderFrame 权限尚无自动情境，静态 authorize 仅按 webContents 注册身份 |
| A23 | NOT_RUN | Stage2–5 开发 SQLite 重启 PASS；本轮 lifecycle integrity/FK/重启设计 | Lead release-smoke 验证空库/重启，另需旧 schema 数据与回执迁移证据；QA 去重后没有重复创建发布迁移夹具 |
| A24 | NOT_RUN | 开发 Electron SQLite 3.53.4 历史 PASS；Stage2 portable 只构建 | Lead 当前 unpacked 与最终 portable 读写/退出/重启；记录 Electron/Node/SQLite/ASAR/native helper。构建成功不是运行证据 |
| A25 | NOT_RUN | Stage4 注册冲突/改键/回退入口；新托盘 mock/close-hide/quit/注销测试 | Lead 真实 OS 快捷键、通知区菜单四路与设置子菜单、关闭全部窗口再恢复、托盘退出/PID 终止；dev/isolated 禁用登录勾选须单列 |
| A26 | NOT_RUN | Stage5 UTF-8 实际字节/取消/新导出隐藏/旧副本不变 PASS 子项 | Lead 原导出回归及真实保存对话框交互，中文/代码/手写区与独立副本提示；dialog stub 不等于真实人机操作 |
| A27 | NOT_RUN | Lead release-smoke 设计：复制包到中文空格路径、阻断 Chromium http/ws；QA 关键 IPC 独立隔离 cwd；静态依赖/范围检查 | 关闭 dev server、OS 断网、portable 解压入口/独立机器或干净 PATH、helper 不依赖 Python/源码；正式路径只审查不清理；隔离测试不替代正式首次启动行为 |
| A28 | NOT_RUN | Stage3 压力 fixture 仅业务正确性，无性能测量 | Lead 固定 Windows 配置发布产物冷启动/闲置/输入/大量记录测量，记录全部 Electron PID 集合、总内存/CPU、采样区间与重复次数 |

## 静态审查发现与发布风险

1. **NOT_RUN：发布 helper 资源完整性。** 初次审查曾见 adapter 选择 exe 而 package 仍列 py 的并行快照差异；Lead 随后明确已接入 prebuild/predev 的 `build:native` PowerShell File 脚本（无 bypass），extraResources 改为 `native/bin/windows_desktop_host.exe`，使用 .NET Framework helper。早期差异不作为最终缺陷。最终 dist 资源存在与实际 helper 启动仍需 Lead/ Desktop 日志；QA runner 强制 fallback 不覆盖 native inspect。无需 QA 修改 package/native。

2. **NOT_RUN：真实托盘退出及 OS 登录设置。** `trayTemplate` 是纯模板；`createQuietDeskTray` 只在 checkbox click 调用 OS mutation，并以 packaged + win32 + 非隔离条件限制。startup 不调用 setLogin；默认不主动改变用户既有 OS 设置。mock 覆盖 wiring/禁用保护，OS 操作由 Lead 实际验证。当前设置项调用 Library show/focus；它是否足以让用户发现设置由 UI owner 视觉检查，不新增 renderer IPC。

3. **NOT_RUN：发布调试路径。** 当前 Lead 已将固定 Clock、存储 smoke、提交失败注入和快捷键占用限制为 `!app.isPackaged`；userData override 仍供隔离发布测试使用。`QUIETDESK_SHOW_ALL_WINDOWS`、auto quit、测试时区和 suppress external open 仍可由环境触发，应由 Lead 对最终产物界定保留的隔离启动参数，并记录正常启动不启用这些值。不得把测试参数自身当成正式能力或真实 Windows 外链验证。

4. **NOT_RUN：frame 权限补证。** `authorize` 使用登记 webContents 身份，尚未检查 senderFrame 是否主 frame；默认 CSP/导航/窗口打开策略限制 renderer 内容。新增未登记独立窗口负向测试不覆盖同 webContents 的 iframe。该项是静态覆盖缺口，未声称已有可利用漏洞；不在此任务修改生产安全实现或新契约。

5. **NOT_RUN：异步退出。** Lead before-quit 先 preventDefault 并锁定 quitting，注销快捷键/IPC、dispose Capture 和 tray，再 await Desktop dispose，finally close SQLite 后二次 quit。新增测试要求真正 process exit=0，而不是调用 app.quit 后立刻吞掉异常；桌面 native detach/状态落盘晚期仍需真实 host 日志。失败现场应保留，不能通过强杀用户无关进程“通过”。

6. **NOT_RUN：性能与离线组合。** 不自动禁用用户网络、改 DPI、重启 Explorer 或触发睡眠。发布性能报告须把 Electron 浏览器/GPU/renderer/utility 所有 PID 纳入集合；另列 native helper，避免拿单进程 working set 冒充合计。renderer offline 只是自动子项。

文档一致性：PROGRESS 顶部仍是 Stage4 当前结论，而末尾已有 Stage5；CONTRACTS 顶部 v1/v3 说明与末尾 v4 扩展并存。这不改变末尾冻结语义，Lead 最终汇总时应更新头部，QA 没有权限修改。

## 本轮真实检查记录

| 命令 / 检查 | 状态 | 平台 / 退出码 / 证据 |
| --- | --- | --- |
| 文档与生产/测试源码静态读取、`git status --short`、`git rev-parse HEAD` | PASS | Windows PowerShell；HEAD 见开头，未执行 Git 切换/提交。两次辅助读取误用不存在的 renderer 文件名、一次 rg Windows glob 返回错误，之后使用 rg 文件清单定位；这些不是产品测试失败 |
| `node --version` / `npm --version` | PASS | v22.13.1 / 10.9.2，退出 0；这不是 Electron 运行时版本 |
| `node --check tests/e2e/stage6-runtime.mjs`、`stage6-lifecycle.mjs`、`stage6-release.mjs`；`node --check tests/platform/stage6-release-audit.test.mjs` | PASS | 四条分别退出 0，Node v22.13.1 / Windows；不启动应用 |
| `node --test tests/platform/stage6-release-audit.test.mjs`（报告完成后） | PASS | 退出 0，4/4，约 116 ms；Lead 早先报告不存在期间的 3/4 是中间测试依赖未就绪，不是产品缺陷；最终矩阵测试通过 |
| `git diff --check --` 六个 QA 文件路径 | PASS | 退出 0；该 Git 命令只检查 tracked diff，新文件语法/内容由上面的 Node 检查覆盖，不声称验证了未跟踪文件的全部空白格式 |
| tray Vitest / check（Lead 本地） | PASS | Lead 本任务反馈 7/7 与 check PASS；QA 未自行执行，没有编造退出码或证据文件 |
| integration / e2e / platform / build / dist / 发布测试 | NOT_RUN | 留给 Lead 串行统一执行，避免与 UI GUI 并发；Lead 新增 scripts/stage6-verify.mjs 记录命令日志 |
| Stage6 UI 英文 320 baseline（UI/Lead 反馈） | FAIL | 标题换行挤压条目；本 QA 未亲自跑图，尚无收到的最终 run 路径。UI 已修 CSS，不将实现修复记为测试通过 |
| Stage6 UI targeted 6 screenshots 最终复跑 | NOT_RUN | Desktop 后由 UI/Lead 串行执行；证据占位：命令、退出码、run/manifest 路径、6 张逐图判定、320 标题/条目可发现性；最终反馈前保留 NOT_RUN |
| Windows Shell / IME / 真实托盘 / 原生保存对话框 / 截图录屏 / 性能 | NOT_RUN | 本轮未执行，无新增人工证据 |

## Lead 执行与判定顺序

1. 在 agent 停止写入后核对最终 shared/IPC/bootstrap 元信息、Desktop helper manifest 和窗口关闭实现；QA 没有强行更新历史脚本的 stage/version 断言。Lead 若升级元信息，需要同步 Stage3/4/5 harness 的断言，不删验收条件。
2. Lead 执行 check、单元（含 tray）、integration、旧 e2e，再执行新增 lifecycle；随后 Desktop owned 平台回归、UI owner 视觉回归。新增 MJS 不会被 Vitest include 自动发现，当前 `test:e2e` 是否接线由 Lead 处理。
3. build/dist 后 Lead 先用 `scripts/stage6-release-smoke.mjs` 做复制包、中文空格路径、Chromium 网络阻断、SQLite/重启和 OS/Electron 指标；再指定该轮绝对 packaged exe 运行 QA release IPC 命令。具体可用产物路径由 Lead build 完成后确认；此刻 QA 没有启动或假定产物已生成。最终 portable 解压器仍需独立证据，记录 artifact path/hash/commit/PID/退出码，不使用旧 Stage2 exe。
4. Windows GUI 单独收集 A01–A06/A11/A25/A26/A27 证据；Explorer/睡眠/网络变化仅在授权环境执行。最后做 A28 真实测量。没有执行的组合保持 NOT_RUN，核心桌面缺口未闭合时不能发布“桌面组件完成”结论。

需 Lead 决策：最终 helper 资源/发布入口、发布环境参数保留边界、正常 userData 首启与 portable/offline 的独立证据。无需新增测试契约；若后续要通过 IPC 观测 tray/native 状态，则先交 Lead 冻结，QA 不自行发明接口。

QA 交接已完成；没有 GUI 在运行或等待，Lead 可释放本任务槽给 Data locale 修正。最终需要串行运行的新增命令是 `node tests/e2e/stage6-lifecycle.mjs` 和 `node tests/e2e/stage6-release.mjs "<本轮绝对 packaged exe 路径>"`；不自动覆盖 Lead 的 release smoke，也不自行接线 package 脚本。失败不得删断言或改 mock。

## Lead 集成后复核（2026-09-26，非 QA agent 追加执行）

以上内容保留 QA 交接时的 NOT_RUN 快照。Lead 随后实际运行最终 check/integration/e2e/build/dist:win，全部退出0；lifecycle覆盖真实监听取消、DOM刷新、close-hide、quit释放快捷键和第二PID恢复；release IPC 19个拒绝情境PASS。原probe从getLastWebPreferences读取preload实际无效导致首轮FAIL；Lead改为真实产物preload绝对路径，用同一file URL的未登记sandbox窗口仍完整断言FORBIDDEN，未改mock或绕过安全。退出前缓存ChildProcess引用避免Playwright dispatcher销毁后的查询。

真实发布/portable中文空格路径、helper、SQLite重启与v3→v4迁移PASS；unit Data/Platform69、renderer4、static audit4通过。UI基线9失败保留，定向36截图已逐图检查PASS，Lead另检查发布3截图。原生SendInput实际中文候选＋composition以及真实保存对话框已检查，不是DOM composition模拟或dialogoverride；原生会话收尾隐藏窗口截图FAIL单独记录，修复后相同独立数据库重启退出0。

完整最终矩阵、每项命令/退出码/环境/证据及未测项以 `docs/ACCEPTANCE.md` 阶段6和 `docs/RELEASE-CHECKLIST.md` 为准；本报告原28项不原地冒称QA自身执行通过。Win+D/覆盖/连续鼠标自由缩放、托盘点击、Explorer重启、睡眠、其他DPI/多屏、整机断网、长期泄漏仍NOT_RUN，最终桌面签核BLOCKED。
