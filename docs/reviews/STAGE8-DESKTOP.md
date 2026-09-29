# 阶段 8A：Windows 桌面宿主验收入口（2026-09-29）

当前结论：**开发预览，桌面验收未完成**。A01 的 Win+D 与普通窗口遮挡仍是 **BLOCKED**：本轮拿到了同一交互桌面上的原生挂接诊断，但没有执行真人 Win+D、普通窗口遮挡/恢复。没有观察到行为错误，不能把缺证据写成宿主实现 `FAIL`；`visible=true`、`SetParent`/`inspect` 成功和截图都不足以签核遮挡关系。

## 基线、产物与真实分工

- 工作目录：`C:\Users\50199\Desktop\web_proj\QuietDesk`。开始时 `git status --porcelain=v1` 为空；HEAD 与参考 `ce9e6b2` 均为 `ce9e6b2924bd6217e37f7a655649101c6e7985a6`，`merge-base` 同值，双向新增提交数 `0/0`。本轮未切换、回退、提交或推送；本文件和诊断入口是未提交改动。
- 实测 portable：`release/QuietDesk 0.1.0.exe`，101,375,902 字节，文件/产品版本 `0.1.0`，修改时间 `2026-09-27T09:14:44.3135219Z`；本轮重算 SHA-256 `2E839917F1489B3EB60D06FD23439E4E6A201F3D7A8BD46FC30DF09CEF404104`。与阶段7 `commands-1790500222655/18.log` 的构建结束时间、`results.json` 的 `dist:win` 退出0以及阶段7文档哈希相符；阶段7发布/portable smoke 为构建后实际运行证据。当前 `release/win-unpacked/QuietDesk.exe` 另有 SHA-256 `6381B25B5FA9DD1F4E9E6D86C8A5AA544FDCF2983E6E61727CC851EB040CE2AE`，**本次人工待测对象是前述 portable，不混用**。
- 构建绑定：`ce9e6b2` 提交时间在上述 portable 修改时间之后；该提交相对 `2d98645` 没有改 `src/`、`native/`、`package.json` 或锁文件，但包含测试与文档改动。包内未发现嵌入的 Git SHA 或签名生成清单，故“portable 精确由某提交构建”标 **UNVERIFIED**；文件名/版本号不是提交证明。阶段7同一构建流程的发布进程报告 Electron `44.4.3`、内置 Node `24.21.0`、SQLite `3.53.4`，见 `test-results/stage7/发布 验证 1790500222656/report.json`；本轮不是重新执行版本 IPC 探针。
- 真实只读子 agent：Desktop/Environment `01a0ed6e-1004-7e50-833e-80fcdc65ca23` 核查 `native/`、`src/main/platform/`、`src/main/windows/` 与 Session；QA `01a0ed6e-10fe-7033-98e0-a9db52a4a207` 独立核查 `tests/platform/`、`tests/e2e/`、旧诊断及 A–F 步骤。二者并行、修改文件均为0，已关闭。Lead 独占基线、portable、隔离启动、只读诊断与本文/PROGRESS；没有 agent 修改生产宿主代码。

## 为什么旧 A01 是 BLOCKED

1. `tests/platform/desktop-spike.platform.test.ts` 在 Windows 真跑了 attach/`inspect`、父类 WorkerW、几何和一次焦点检查；`test.skipIf(process.platform !== 'win32')` 仅是非 Windows 条件，不是 Win+D 用例被跳过。旧证据 `test-results/desktop-stage7/2026-09-27T09-10-34-555Z/desktop.json`。它约 3.5 秒后退出，没有按 Win+D 或用普通应用窗口挡住 Widget。
2. `tests/e2e/windows-shells.mjs` 和共用 `stage3-harness.mjs` 显式设 `QUIETDESK_FORCE_FALLBACK=1`，用于业务/DOM/IPC；其他截图和 `setBounds` 也不是 Shell 层级或真人鼠标连续缩放证据。
3. `native/windows_desktop_host.cs` 使用未公开的 Progman 消息 `0x052C`、WorkerW/DefView 结构、`SetParent` 和样式位；`src/main/windows/desktop-spike-window.ts` 的 `showInactive()`、不置顶、跳过任务栏、定期 inspect 是实现事实。`inspect` 的成功主要证明父句柄/类，**不证明** Win+D 后被 Shell 保留或普通窗口的真实遮挡。WorkerW/Progman 不是稳定公共 API。
4. 阶段6的 computer-use 技能明确禁止自动发送 Windows 键组合；本轮也遵守。当前 Windows GUI 可观察但目标 Widget 作为 WorkerW 子窗口没有出现在 `sky.list_apps()` 的可控窗口列表；不能把其它截图或网页事件代替 Win+D。真人可以在普通交互桌面完成该步骤。

## 本轮实际环境与一次性诊断

| 检查 | 结果与证据 | 状态 |
| --- | --- | --- |
| Windows / 图形会话 | `Get-CimInstance Win32_OperatingSystem`：Windows 11 专业版 x64、Build `22631`；`quser`：active console Session 1。当前本机可执行 Windows GUI，非 WSL。 | PASS |
| 当前 Codex 是否在 private desktop | 一次性 Win32 诊断：Lead 启动的观察进程为 Session 1 / `WinSta0` / `Default`，input desktop 为 `Default`；Codex 前台主窗口 PID 6508 的 GUI thread desktop `Default`；Explorer PID 5984 主窗口 GUI thread desktop `Default`、Session 1。**本次不是不同 private desktop**。仅线程 desktop 名称与当前观察进程 window station 实测；没有远程读取 Codex/Explorer 的 process window station。 | PASS（桌面/会话）；远程 window station NOT_RUN |
| 本次 isolated 启动 | `scripts/stage8-desktop-session.ps1 -Action Start` 退出0，从 `release/QuietDesk 0.1.0.exe` 启动；独立 userData 为 `test-results/stage8/manual-20260929-215557-910fc4b6/userData`，其 `data/quietdesk.sqlite3` 已创建。启动前无其它 QuietDesk 或仓库 dev server；启动后6个 `QuietDesk.exe`，其 `--user-data-dir` 指向该隔离路径。没有读写正式库。 | PASS |
| 首次自动快照的竞态 | portable 解包尚未完成时（21:56:02 本地）第一次快照显示0进程/0候选；这不是挂接失败。随后 21:56:17 与 21:57:12 重取确认6进程/1个 WorkerW 子窗口。启动脚本已改为等待 packaged child 再取快照；新启动流程尚未另起第二份实例复测。 | PASS（重取）；新 Start 轮次 NOT_RUN |
| Widget / Explorer 匹配 | `snapshot-20260929-215712-924.json`：Widget HWND `0x80668`、GUI PID `26872`、thread `13188`，Session 1、desktop `Default`；parent HWND `0x430910` / `WorkerW`，parent PID `5984`（Explorer）、Session 1、desktop `Default`、`parentVisible=true`。Widget `visible=true`、owner `0x0`、styles `0x54070000` / exStyle `0x200180`、DPI 144、边界 `(607,298)–(1098,724)`。这记录了本次真实桌面宿主挂接，不是普通 fallback。 | PASS（挂接诊断） |
| Native helper | 同一快照通过正在运行的 portable 解包目录中的 `resources/native/windows_desktop_host.exe inspect 525928`，退出0，返回 `success=true`、`inspect-workerw`、相同父句柄。helper SHA-256 `6E86C5D54DCA8D9BAD9D9F724684D8BB5EB60F88D2342108B0D88964F501DCFF`，与仓库 `native/bin` 和 unpacked 发布资源一致。helper 短命，本轮没有同时抓到其自身进程的 session/window station/desktop；不能由“inspect 成功”推定这些项被直接观测。 | PASS（inspect）；helper 自身上下文 NOT_RUN |
| 可见/Z-order/前台 | 只读工具记录 widget/parent 可见位、owner、父窗口前一顶层窗口、Widget 前一 sibling 与前台 HWND/PID；**只用于定位**。没有真实无遮挡/遮挡画面，不能据这些字段给 A01 PASS。 | PASS（字段采集）；行为 NOT_RUN |

诊断工具在 `tests/platform/stage8-desktop-diagnostic.cs`；C# 由本机 Framework64 `csc.exe` 编译到 ignored `test-results/stage8/`，不注入 Explorer，不改窗口行为，不持续监听。它只记录本应用相关窗口的句柄/parent/owner/样式/DPI/边界、Explorer/Codex 的 desktop 摘要和前台 HWND/PID，**不读笔记正文、键盘内容或无关窗口标题**。`scripts/stage8-desktop-session.ps1` 生成可回传的 `context.json` 与按需 `snapshot-*.json`。诊断工具中的 `Environment.OSVersion` 可能受 .NET 清单兼容视图影响（显示 NT 6.2）；准确 Build 使用同一快照的 CIM `windowsBuild=22631`。

## 真实对照测试入口（需要用户在正常桌面手动操作）

本轮应用已在上述隔离 userData 中运行，测试对象是同一 SHA 的 portable。若已退出，需要在普通本地 PowerShell 中先**正常退出**所有 QuietDesk 实例和仓库开发服务器，再运行：

```powershell
cd 'C:\Users\50199\Desktop\web_proj\QuietDesk'
& .\scripts\stage8-desktop-session.ps1 -Action Start
```

脚本拒绝与既有 QuietDesk/仓库 dev server 并行，不会替用户结束进程；每次创建新的 ignored `test-results/stage8/manual-*` 和 `userData`，对该启动进程设置 `QUIETDESK_TEST_USER_DATA`，清除 `QUIETDESK_FORCE_FALLBACK` / dev URL /测试故障标志，启动原 portable 后恢复终端原环境。若用户选择资源管理器直接双击 portable，**不会继承这份隔离数据设置**，因此不要把无配置的双击当成本轮安全入口。无需管理员权限。脚本打印真实目录和快照路径；以该轮输出的 `RUN_DIRECTORY` 为准，不要混用旧轮数据库。初始快照若仍为0或只有 fallback，先用 `-Action Snapshot` 重取并停止将该轮称为桌面验收。

手动最短顺序：先使桌面自然露出，确认 Widget 在露出区域可见；普通应用覆盖时，只要求**被覆盖的区域**不浮在应用上方，未覆盖的桌面区域仍可显示 Widget。保持同一次实例，按顺序执行：

| 用例 | 真人动作与预期 | 本轮状态 |
| --- | --- | --- |
| A | 把一个普通应用窗口移到 Widget 上：覆盖区域由普通窗口遮住。 | NOT_RUN |
| B | 按一次 Win+D：显示桌面后 Widget 仍可见。 | NOT_RUN |
| C | 再按一次 Win+D：普通窗口恢复且仍正确遮挡 Widget。 | NOT_RUN |
| D | 点击 Widget，再操作普通窗口：Widget 不变成持续置顶；未覆盖处仍可见。 | NOT_RUN |
| E | 鼠标拖动、边缘连续缩到非预设尺寸（如 437×386 DIP），点击日期/捕获等交互入口；无拖动区域吞键。正常退出重启后检查尺寸/位置。 | NOT_RUN |
| F | 主动按 Ctrl+Shift+Space 唤起 Capture（若冲突，观察提示并从 Widget 入口打开）：Capture 可聚焦输入，但 Widget 不持续置顶。 | NOT_RUN |

建议只拍测试区域的一段连续短录屏或 A/B/C/D 截图并记每步实际观察；不要拍私人桌面内容。动作前后或出现异常时，在普通 PowerShell 中按需运行一次快照，**不持续采集**：

```powershell
& .\scripts\stage8-desktop-session.ps1 -Action Snapshot -RunDirectory 'C:\Users\50199\Desktop\web_proj\QuietDesk\test-results\stage8\manual-20260929-215557-910fc4b6'
```

回传只需 A–F 每步一句观察、相关录屏/截图（可打码）和当轮 `context.json` / `snapshot-*.json` 路径或已删除本机路径信息的摘要；不要回传数据库、完整应用 stdout、笔记正文、无关窗口标题。若画面错误，优先比较**同一实例**异常前后的 mode badge、parent/owner、`parentVisible`、foreground 和相对层级，再定向判断是 Shell 挂接、恢复还是 UI 命中问题。不先改生产宿主。Explorer 重启、睡眠、100%/200% 和拔屏本轮均 NOT_RUN，不在用户日常系统中擅自执行。

## 判定与下一步

| 门槛 | 状态 | 解除条件 |
| --- | --- | --- |
| native 挂接/同 Session+desktop 的当次诊断 | PASS | 已有本轮快照和 helper 独立 inspect；这不是完整桌面验收 |
| A–F 真实 Windows 行为 | NOT_RUN | 用户在正常交互桌面执行上表动作并回传观察；出现实际错误才写 FAIL |
| A01 完整桌面语义 | BLOCKED | 需要 A–D 的同一产物、同一正常桌面的直接观察；用户可完成，Lead 当前不可自动发送 Win 键 |
| A03 自由鼠标缩放/交互 | NOT_RUN | 需要 E 的真实鼠标动作、命中及重启观察；已有 setBounds/截图不代替 |
| helper 自身 window station 与多屏/DPI/Explorer/睡眠 | NOT_RUN | 另在可观测/明确授权的测试环境按需核验；不推测 PASS |

若 A–F 通过，不为体现进展而更改 WorkerW 实现；若失败，提供同一步的截图/诊断再做最小定向修复。旧安全报告仅绑定 `f3f40ec0984591d0b2d4aa2ddda00f528664ae68`，阶段7修复后为 partial 复核；本阶段只做桌面诊断，**不将安全覆盖扩写为最新版完整扫描**。

## 后续报告：关闭后桌面残留的定位（同日）

用户报告关闭后桌面有残留；目前尚未说明关闭方式或残留形态，也没有残留画面证据。Lead **未**先修改生产窗口/Shell 代码，也未重启 Explorer 或结束用户进程。

- 当前上文的隔离 portable 启动器 PID `26964` 和主进程 PID `26872` 仍在，6 个 `QuietDesk.exe` 子/主进程持续存在。`snapshot-20260929-220304-617.json` 显示原 Widget HWND `0x80668` 仍为 `visible=true` 且仍挂在 Explorer WorkerW 下。**当前实例没有真正退出**；不能把它等同于进程退出后 Explorer 的像素残影。
- 源码 `src/main/index.ts` 的 resident window `close` 事件会 `preventDefault()` 并 `hide()`；托盘 `src/main/tray.ts` 的“退出 QuietDesk”才调用 `app.quit()`，随后等待保存、解绑宿主和退出。区分隐藏与退出是既有产品约束，不能未经确认把窗口关闭改为丢弃草稿的强制退出。
- 新增隔离回归 `node tests/platform/stage8-native-close.mjs`：开发 Electron + 原生 WorkerW，退出码0；`--release`：`release/win-unpacked/QuietDesk.exe` + 原生 WorkerW，退出码0。两次都实测：`window.close()` 后 `visible=false`、`destroyed=false`；`app.quit()` 后退出码0、原 HWND 不再是活动窗口。证据分别在 ignored `test-results/stage8/native-close-dRq9fV/report.json` 和 `native-close-Tvlgpm/report.json`。首次 harness 因窗口尚未创建就取 `app.windows()[0]` 退出1，修为等待 `firstWindow()` 后两轮通过；这是测试时序失败，不是产品失败。
- 新增隔离 `node tests/platform/stage8-exit-smoke.mjs`：原生 WorkerW 已挂接，自动正常退出码0；退出前后 Explorer 所属被列举的 WorkerW/Progman/DefView 窗口数量均为38，新增/消失句柄均为0。证据 `test-results/stage8/exit-smoke-dGXCiA/report.json`。这只反驳“这一次正常退出新留一个 Shell 窗口”；**不能**证明没有像素残影或所有退出路径都正确。
- 按需诊断现也列出 Explorer 的 WorkerW/Progman/DefView 句柄、可见位和边界，不记录窗口标题或正文。现存若干隐藏 WorkerW 的来源未确认，不据数量归咎于 QuietDesk。

因此本问题当前状态 **BLOCKED**：需要用户说明是点击窗口关闭按钮、托盘“退出 QuietDesk”还是强制结束进程，并在执行托盘明确退出后观察残留是否还在、任务管理器中 QuietDesk 进程是否消失。若应用仍在，先定位关闭/退出路径；若进程已消失但画面仍在，再用退出前后同一桌面的截图与上述快照对比，定向处理 Shell 重绘。没有物理画面观察就不能把本轮自动检查写成“残留已修复”。

## 关闭后残影的定向修复与复核（同日后续）

用户进一步确认：软件已关闭，但桌面仍有残影。Lead 在同一 Windows 11 Build 22631 / Session 1 上只读检查时，`QuietDesk.exe` 进程数为 0，原 Widget HWND 不再存在，Explorer 的 WorkerW 宿主仍正常存在。这排除了当次“应用还在画面上”的解释；残影像素本身未被工具直接捕获。当前 computer-use 入口只列出 Codex、Edge、Clash Verge 等可截图窗口，未暴露桌面/Explorer 截图目标，故不能声称肉眼已确认像素形态或视觉修复。

最小修复针对退出清理顺序：`DesktopSpikeWindowController.finishDispose()` 先保存窗口状态，再隐藏可见的 Widget，最后执行 native `detach`，避免可见的 WorkerW 子窗口在 `SetParent(NULL)` 时短暂成为顶层窗口；原生 helper 在解绑后仅对已核验的原 WorkerW/Progman 宿主调用 `RedrawWindow` 请求重绘。没有注入或重启 Explorer、修改安全设置、触碰正式数据，也没有改变“普通关闭=隐藏、托盘退出=结束”的生命周期语义。WorkerW 仍是未公开 Shell 结构，不能保证所有 Windows/DPI/驱动组合。

本次构建来源为本地未提交工作树，HEAD `ce9e6b2924bd6217e37f7a655649101c6e7985a6` 加上述源码改动；**不能将新 portable 等同于该 HEAD 的纯净构建**。`npm run dist:win` 退出 0，生成 `release/QuietDesk 0.1.0.exe`，SHA-256 `EA9F324F251BB63E322CB71153CC97C515C30A89ACDA1D23D380158C2A584235`；包内 `app.asar` 为 `118F673403A55CE51100639D2C40EFBE8B64AEF4407E034A4BB7E1E681BB12C9`，`resources/native/windows_desktop_host.exe` 为 `1FED7FF659479C30BAF95FEB235F6CF61DE5DB0D5003B084300EC9C227883058`。先前 SHA `2E8399...` 的旧包已被构建覆盖；不得混用旧测试结果。版本仍为 0.1.0，单靠文件名无法识别修复版。

| 检查 | 状态 | 真实证据 / 边界 |
| --- | --- | --- |
| `npm run check` | PASS | 退出 0；TypeScript 和 17/17 契约测试 |
| `npx vitest run tests/platform/desktop-lifecycle.test.ts` | PASS | 退出 0；3/3，新增可见窗口按 `hide → detach` 顺序的断言 |
| `npm run build:native`、`npm run build`、`npm run dist:win` | PASS | 各退出 0；Electron 44.4.3 / win32 x64 portable |
| `node tests/platform/stage8-native-close.mjs` | PASS | 退出 0；真实开发 Electron 原生 WorkerW 关闭/退出路径 |
| `node tests/platform/stage8-native-close.mjs --release` | PASS | 退出 0；新打包 `win-unpacked/QuietDesk.exe`，隔离 userData；`test-results/stage8/native-close-IWToKW/report.json`：普通 close 后 `visible=false`，`app.quit()` 后进程退出 0、旧 HWND 消失、无 `QUIETDESK_SHUTDOWN_ERROR` / redraw 错误 |
| `node tests/platform/stage8-exit-smoke.mjs` | PASS | 退出 0；隔离原生实例已挂 WorkerW，退出前后 Explorer 相关窗口均 38、无新增句柄；`test-results/stage8/exit-smoke-d9fPgF/report.json`。数量稳定不等于画面无残影 |
| 同一新 portable 的实际桌面关闭后像素观察 | NOT_RUN | 当前工具无桌面/Explorer 截图目标；需要用户在正常交互桌面确认，不以 HWND 消失冒充视觉 PASS |

下一步只需在没有其它 QuietDesk 实例及开发服务器时，运行 `scripts/stage8-desktop-session.ps1 -Action Start`（它会为**当前新 portable**创建隔离 userData，并输出实际目录和 SHA）；让 Widget 自然显示，托盘选择“退出 QuietDesk”，然后观察同一位置是否还留图像，并按需运行 `-Action Snapshot -RunDirectory <本次输出的目录>`。请只回报“残影消失/仍在”、关闭方式及本次 `RUN_DIRECTORY`；若仍在，最好附只包含 Widget 区域的退出前后画面。A–F 的 Win+D/覆盖验收仍独立为 NOT_RUN/BLOCKED。未经用户实际观察，本问题只能称为“清理路径已修复并自动复核，视觉结果 NOT_RUN”。

Lead 已实际运行上述 `-Action Start`，退出 0；当前待用户操作实例的 `RUN_DIRECTORY` 是 `test-results/stage8/manual-20260929-225530-e64018f1`，实际 userData 是该目录下 `userData`。`snapshot-20260929-225539-746.json` 记录新 portable SHA `EA9F...`、6 个 QuietDesk 进程、Widget HWND `0x260AFE` 可见并挂在 WorkerW，打包 native helper `inspect` 退出 0；该实例特意保持运行，供用户执行托盘退出后的残影观察。启动与挂接诊断 **PASS**，退出后的当前实例视觉结果仍 **NOT_RUN**。

### 用户实测反证（同一新 portable）

用户按上述步骤在正常交互桌面托盘选择“退出 QuietDesk”，明确报告原位置仍有残影，并提供退出后的局部截图（用户临时附件，不复制入仓库）。截图显示桌面壁纸上有大块白色矩形空白区域，**视觉结果 FAIL**；不是自动测试推测。Lead 随后一次性只读诊断：`QuietDesk.exe` 进程数 0，`quietDeskWindows` 空，原 Widget HWND `0x260AFE` 不存在，而 Explorer PID 5984 的宿主 WorkerW `0x430910` 仍可见。因此不是仍在运行的 QuietDesk 窗口；`hide → detach → RedrawWindow(WorkerW)` 在本次实际用户画面中**未消除残影**。此前自动关闭、句柄消失和 helper 成功仍是 PASS，但不能提升为画面 PASS。

当前待验证的机制是 Shell/分层宿主的合成或壁纸背景未重新呈现。截图白区远大于启动时记录的 Widget `(607,298)–(1098,724)`；是否还涉及用户后来调整窗口、截图裁切/缩放或其他画面层，单凭该图不能定论。已向用户询问正常应用窗口覆盖再移开是否消除白区。不会在用户日常桌面上重启 Explorer、擅自重设壁纸或修改全局显示设置；不能套用其它桌面挂接项目的 `SPI_SETDESKWALLPAPER(null)` 绕过多屏/幻灯片配置风险。下一步是最小只读定位与经实测有效的定向修复，完成前桌面残影保持 **FAIL**，整体桌面交付仍 **BLOCKED**。
