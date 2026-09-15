# QA-S1-plan：Windows 桌面宿主与自由缩放测试设计

> 状态：测试设计完成；可执行的自动化部分已于 2026-09-15 执行。平台套件因默认窗口高度偏差而 `FAIL`，Windows GUI 与破坏性项目仍为 `NOT_RUN`；不得据此声明 QuietDesk 已通过桌面验收。

## 1. 目标与范围

本计划独立验证阶段 1 的窗口风险，不验证完整业务、SQLite、Markdown、主题或打包发布。覆盖 `A01`—`A05` 中的桌面宿主、焦点、窗口几何、DPI/显示器和恢复子项。

有效证据必须来自实际 Windows Electron 窗口。浏览器预览不能作为桌面证据；`alwaysOnTop: false`、`skipTaskbar: true` 或普通无边框窗口也不能证明窗口属于桌面。若宿主挂接依赖 Progman、WorkerW 或其他 Shell 内部窗口结构，只能将其视为当前 Windows 构建上的非稳定实现依赖。

## 2. 状态与证据规则

- 状态仅使用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。
- `PASS` 要同时满足用例的全部判定，并附命令退出码、结构化诊断或已检查的 Windows GUI 截图/录屏。
- 环境或实现缺少必要入口时标 `BLOCKED`；具备条件但未执行时标 `NOT_RUN`。
- 部分步骤通过不能把整个用例写成 `PASS`，应逐项记录子结果，并按未满足的关键步骤给出 `FAIL`、`BLOCKED` 或 `NOT_RUN`。
- 截图、录屏、测试 userData 和状态文件必须保存在忽略目录或仓库外，不能混入源码提交；报告只记录脱敏路径、时间和摘要。
- 真桌面模式必须至少有 `mode=desktop`、`attached=true`、原生父窗口句柄/类名与挂接后复核结果。窗口选项仅作旁证。
- 降级模式必须有 `mode=fallback`、`attached=false`、失败原因和可见的“开发降级”标识；降级窗口不得用于通过 Win+D 或桌面驻留检查。

每次执行先保存以下环境基线：

| 字段 | 证据来源 | 初始状态 |
| --- | --- | --- |
| Windows 版本、Edition、Build、架构 | `Get-CimInstance Win32_OperatingSystem` 与应用 `windowsBuild` | NOT_RUN |
| Electron、Node、QuietDesk 构建标识 | 锁文件、启动日志 | NOT_RUN |
| 运行权限 | 当前进程令牌/启动方式；应为非管理员常规运行 | NOT_RUN |
| 显示器拓扑、主屏、每屏边界/工作区/缩放 | Electron `screen` 快照与 Windows 显示设置截图 | NOT_RUN |
| 窗口模式和原生关系 | `DesktopHostStatus` 完整 JSON；不得包含用户正文 | NOT_RUN |
| 测试数据隔离 | 独立临时 userData 路径；结束时不清理真实用户数据 | NOT_RUN |

## 3. 自动化诊断与确定性检查

以下检查待 Desktop 实现完成后由 QA 在 `tests/platform/` 中独立补充并执行。测试应调用公开适配器边界或启动真实 Electron，不复制实现逻辑。

### QA-S1-01：真实宿主状态不能由普通窗口选项冒充

- 对应：A01、A05；真实模式与 fallback 区分。
- 前置条件：可启动构建；`DesktopSpikeApi.getStatus()` 可用；原生适配器能返回挂接与复核诊断。
- 步骤：
  1. 用隔离 userData 启动，不强制降级，保存首个 `DesktopHostStatus`。
  2. 若报告 `desktop`，独立再次检查窗口当前父句柄/类名和附着关系，记录 `route`、窗口样式、扩展样式与 Windows Build。
  3. 检查 `alwaysOnTop=false`、`skipTaskbar=true`、`resizable=true`、`transparent=false`，但不把这些字段当作宿主成立条件。
  4. 调用一次明确的重试入口，保存重试前后状态与 `recovery` 计数。
- 客观证据：两份状态 JSON；原生 inspect 输出；进程退出码；当前 Windows Build；窗口父子关系在重试后仍成立或明确降级。
- PASS：`desktop` 仅在独立 inspect 确认实际 Shell 宿主关系时出现；失败时返回明确原因并切为可见 fallback，不能静默保持 `desktop`。
- FAIL：只凭窗口选项报告 `desktop`；父关系复核失败但仍称已附着；错误被吞掉。
- 初始状态：`NOT_RUN`。

### QA-S1-02：强制 fallback 的状态和界面可区分

- 对应：A01、A05；降级语义。
- 前置条件：Lead 提供确定性的开发/测试降级启动开关，且不改变生产默认行为。
- 步骤：
  1. 用隔离 userData 和强制降级开关启动。
  2. 读取状态，并在实际 Electron 窗口中检查模式标签和失败/降级说明。
  3. 触发重试；记录实现是保持强制降级，还是在明确解除强制条件后才尝试真宿主。
- 客观证据：启动命令、退出码、状态 JSON、已检查 Electron 窗口截图。
- PASS：状态为 `fallback`、`attached=false`，界面明显显示“开发降级”，诊断给出原因；不存在静默伪装成桌面的路径。
- FAIL：fallback 与 desktop 显示相同；fallback 声称通过 A01；只依赖 `skipTaskbar` 或非置顶属性作区分。
- 初始状态：`NOT_RUN`。

### QA-S1-03：边界恢复与状态文件容错

- 对应：A03、A04。
- 前置条件：窗口边界恢复逻辑可通过公开纯函数或适配器局部入口测试；测试目录与正式 userData 隔离。
- 步骤：
  1. 以合成显示器工作区测试默认 480×420 DIP、最小 320×240 DIP 和非预设尺寸 437×386 DIP。
  2. 输入部分越界、完全离屏、负坐标、尺寸小于最小值、尺寸大于工作区、已移除显示器、损坏 JSON 和缺失字段。
  3. 分别使用 1.0、1.5、2.0 `scaleFactor` 的显示快照，检查算法按 DIP 恢复并至少保留可操作区域。
  4. 验证状态写入采用可恢复策略，不会让半写文件覆盖最后一个有效状态。
- 客观证据：Vitest 用例名称、命令、退出码、断言输出；临时状态文件仅位于测试目录。
- PASS：合法边界原样恢复；非法/离屏状态被限制到可见工作区；宽高不低于 320×240 DIP；损坏状态安全回退且不触碰正式数据。
- FAIL：使用固定像素冒充 DIP；原显示器移除后窗口不可达；损坏状态导致无法启动；测试读写正式 userData。
- 初始状态：`NOT_RUN`。

### QA-S1-04：窗口配置与安全边界静态/运行时检查

- 对应：A02、A03、工程边界。
- 前置条件：Desktop 实现和构建产物可读；真实 Electron 可启动。
- 步骤：
  1. 检查 BrowserWindow 运行状态：默认 480×420、最小 320×240、`resizable=true`、`transparent=false`、`alwaysOnTop=false`。
  2. 检查 `contextIsolation=true`、`nodeIntegration=false`、renderer sandbox 开启。
  3. 检查宿主桥接以独立进程/原生 helper 调用，不向 Explorer 注入模块，不要求管理员权限，不接受 renderer 提供的任意命令或句柄。
- 客观证据：运行时状态、适配器审查记录、构建/类型检查退出码。
- PASS：上述边界全部成立；本项只证明配置和边界，不单独证明 A01/A02 的可见行为。
- FAIL：透明窗口被未经验证地作为默认；关闭 Electron 隔离；执行任意 shell；注入 Explorer；要求管理员常驻。
- 初始状态：`NOT_RUN`。

## 4. Windows GUI 与人工/辅助执行

这些用例必须针对实际 Electron 窗口。可使用当前允许的窗口级自动化完成点击、拖动和截图，但当前控制能力不得自动发送 Windows 键，因此 Win+D 步骤固定由人工执行并保持 `NOT_RUN`，直到人工作出记录。

### QA-S1-05：桌面露出与 Win+D 后仍可见

- 对应：A01。
- 前置条件：实际 Windows 交互会话；状态已被 QA-S1-01 确认为 `desktop`；录屏已开始；桌面无敏感内容。
- 步骤：
  1. 启动 QuietDesk，等待宿主状态稳定，不点击窗口。
  2. 人工最小化/移开普通窗口，使桌面露出，确认 Widget 可见。
  3. 打开一个普通非置顶应用并保持前台。
  4. 人工按 Win+D；不得由自动化工具发送 Windows 键。
  5. 确认显示桌面后 Widget 仍可见，并保存按键前后连续录屏和状态 JSON。
- 客观证据：包含普通应用前台、Win+D 动作、桌面与 Widget 的连续录屏；前后状态 JSON；Windows Build。
- PASS：真实 desktop 状态下，桌面自然露出和人工 Win+D 后均可见；过程中没有切为 fallback。
- FAIL：Win+D 后消失、变成普通前台悬浮窗或静默降级。
- 初始状态：`NOT_RUN`（当前不得自动发送 Windows 键）。

### QA-S1-06：普通窗口可以覆盖 Widget

- 对应：A01。
- 前置条件：QA-S1-01 的真实宿主成立；普通测试应用不是置顶窗口。
- 步骤：
  1. 记录 Widget 的屏幕矩形。
  2. 将记事本等普通应用移动到完全覆盖该矩形并激活。
  3. 检查覆盖区域，随后移开普通应用，确认 Widget 仍在桌面位置。
  4. 保存覆盖前、覆盖中、移开后的连续证据和宿主状态。
- 客观证据：连续录屏或三张带时间的全屏截图；前景窗口名称/句柄；Widget 边界与父窗口诊断。
- PASS：普通非置顶窗口完全覆盖 Widget；移开后 Widget 重新从桌面露出，仍为 `desktop`。
- FAIL：Widget 浮在普通应用上方、被关闭、丢失宿主或只靠手工隐藏模拟覆盖。
- 初始状态：`NOT_RUN`。

### QA-S1-07：启动与恢复不抢焦点

- 对应：A02。
- 前置条件：可记录前景窗口句柄；一个普通文本编辑器已聚焦；QuietDesk 未运行。
- 步骤：
  1. 在编辑器中放置插入点，记录启动前前景 HWND/进程。
  2. 启动 QuietDesk；在启动前后高频采样前景 HWND，并立即继续输入唯一哨兵文本。
  3. 在不点击 QuietDesk 的情况下触发一次宿主恢复/重试或等待一次恢复检查，再次采样并输入第二段哨兵。
  4. 记录 `focused` 字段，但不以单个最终 `focused=false` 排除瞬时抢焦点。
- 客观证据：带时间戳的前景 HWND 序列、编辑器内连续哨兵文本、启动/恢复日志和录屏。
- PASS：启动与非用户触发的恢复全程没有把前景切到 QuietDesk，输入始终进入原编辑器。
- FAIL：任何瞬时或持续焦点切换、输入丢失或进入 QuietDesk。
- 初始状态：`NOT_RUN`。

### QA-S1-08：连续缩放、最小值与拖动

- 对应：A03 的阶段 1 几何部分。
- 前置条件：实际 Electron 窗口；状态显示 `resizable=true`、`transparent=false`；可读取每次操作后的 DIP 边界。
- 步骤：
  1. 从默认 480×420 DIP 沿边角连续拖动到 437×386 DIP，记录拖动过程而非只调用一次程序化 `setBounds`。
  2. 再拖到 611×333 DIP，证明不依赖尺寸预设。
  3. 缩到 320×240 DIP；继续尝试缩小，确认最小限制生效。
  4. 在标题拖动区把窗口移动至少 80 DIP，确认位置变化而宽高基本不变。
  5. 每一步读取状态中的 `windowBounds`，检查视觉命中点与系统边框一致。
- 客观证据：连续录屏；操作前后和中间至少三组 DIP 边界；当前 `scaleFactor`；窗口不透明状态。
- PASS：鼠标连续缩放到多个非预设尺寸；最小尺寸是 320×240 DIP；拖动有效；无跳回预设、卡死或明显命中偏移。
- FAIL：只能选择预设、需要透明降级才能缩放、父宿主后无法拖动/缩放、视觉边缘与命中区域明显错位。
- 初始状态：`NOT_RUN`。

### QA-S1-09：交互区域不被拖动区域吞掉

- 对应：A03。
- 前置条件：壳层提供计数或可观测状态的测试按钮，以及明确的可拖动标题区和 `no-drag` 交互区。
- 步骤：
  1. 在默认尺寸点击测试按钮三次，确认计数恰好增加三次且窗口位置不变。
  2. 在 437×386 和 320×240 DIP 各重复一次点击。
  3. 在按钮上按下并小幅移动后释放，确认不会移动窗口或误触发多次。
  4. 点击重试等第二个交互控件，确认可操作；再从标题空白区域拖动，确认拖动仍有效。
- 客观证据：操作录屏、按钮计数/状态变化、每步窗口边界。
- PASS：所有控件在各尺寸可命中且每次只触发一次；交互区不拖窗，标题区仍可拖窗。
- FAIL：点击被拖动层截获、点击导致窗口移动、缩小后控件不可达或一次操作重复触发。
- 初始状态：`NOT_RUN`。

### QA-S1-10：位置和尺寸跨重启持久化

- 对应：A03。
- 前置条件：独立测试 userData；状态路径可诊断；应用支持正常退出和重新启动。
- 步骤：
  1. 将窗口移动到非默认坐标并缩放为 437×386 DIP。
  2. 等待实现声明的去抖写入完成，保存退出前状态和状态文件摘要。
  3. 正常退出后以同一测试 userData 重启，不进行任何拖动或调整。
  4. 比较重启前后位置、尺寸、显示器和模式；再以另一个空测试 userData 启动，确认使用默认尺寸。
- 客观证据：两次启动命令/退出码、前后状态 JSON、脱敏状态文件、重启录屏。
- PASS：同一 userData 恢复合法位置和 437×386 DIP；新 userData 使用 480×420 DIP；不读写正式数据。
- FAIL：只保存预设、恢复到离屏、状态串到另一个 userData、退出前未落盘却宣称持久化成功。
- 初始状态：`NOT_RUN`。

### QA-S1-11：任务栏、Alt+Tab 与明确交互焦点

- 对应：A02。
- 前置条件：实际 Windows 交互会话；真实 desktop 模式；可人工检查任务栏和 Alt+Tab。
- 步骤：
  1. 启动后人工检查任务栏是否出现普通 QuietDesk 项。
  2. 人工打开 Alt+Tab 视图并录制，确认 Widget 不作为普通应用项出现。
  3. 明确点击 Widget 的交互按钮，确认只有该用户动作可以聚焦对应交互，不把“永不接收交互”误当不抢焦点。
- 客观证据：任务栏与 Alt+Tab 的屏幕录制、明确点击前后的焦点记录。
- PASS：Widget 无普通任务栏/Alt+Tab 条目；非用户事件不聚焦；明确点击时交互可用。
- FAIL：存在普通条目、启动即抢焦点，或为避免焦点而让所有交互不可用。
- 初始状态：`NOT_RUN`。

## 5. DPI 与显示器组合

### QA-S1-12：当前 DPI 的视觉与命中基线

- 对应：A04。
- 前置条件：实际 Windows Electron 窗口；能读取 Electron 显示快照和 Windows 当前缩放设置。
- 步骤：记录当前显示器的 `scaleFactor`、bounds/workArea；执行 QA-S1-08 和 QA-S1-09；比较窗口 DIP 状态、实际屏幕占用和点击位置。
- 客观证据：显示快照、Windows 显示设置截图、缩放/点击录屏。
- PASS：仅表示当前这一个 DPI 配置无严重布局或命中偏移，不能外推到 100%/150%/200%。
- FAIL：当前配置已出现明显偏移、不可见区域或错误尺寸。
- 初始状态：`NOT_RUN`。

### QA-S1-13：100%/150%/200% DPI 与跨显示器

- 对应：A04。
- 前置条件：授权变更显示缩放的测试环境，或已连接具有相应缩放率的多台显示器；不得擅自改变用户工作环境。
- 步骤：
  1. 在 100%、150%、200% 各启动并重复非预设缩放与按钮命中检查。
  2. 将窗口跨屏拖动，记录所在显示器、DIP 边界和缩放率切换。
  3. 在副屏保存位置并重启，确认恢复到该屏可见工作区。
  4. 经授权移除该显示器，再启动，确认窗口被限制回现存显示器可见工作区。
- 客观证据：每个实际组合的显示设置、状态 JSON、录屏和重启记录。
- PASS：仅当 100%/150%/200%、跨屏和原屏移除均实际执行且满足要求；缺少任一组合时整体保持 `NOT_RUN`，可单列已测子结果。
- FAIL：严重布局/命中偏移，或原屏移除后窗口不可达。
- 初始状态：`NOT_RUN`。

## 6. 可能影响用户工作的恢复检查

本节默认不执行。Explorer 重启和睡眠/唤醒只有 Lead 明确确认是授权测试环境后才可运行；不得结束用户无关进程。

### QA-S1-14：Explorer 重启后的宿主恢复

- 对应：A05。
- 前置条件：已保存工作、授权测试环境、持续录屏；存在明确恢复诊断和手动重试入口。
- 人工步骤：记录当前 `desktop` 状态 → 由授权人员使用受控方式重启 Explorer → 等待实现声明的恢复周期 → 检查是否重新附着 → 若失败，检查是否明确显示 fallback 和原因 → 点击重试并保存结果。
- 客观证据：连续录屏、Explorer 前后进程/窗口信息、恢复尝试次数、原生父窗口变化和最终状态 JSON。
- PASS：自动恢复到可复核的真实宿主，或明确显示失败/fallback 并允许成功重试；不得静默成为普通悬浮窗。
- FAIL：崩溃、丢失、静默伪装、无限忙循环或要求管理员权限。
- 初始状态：`NOT_RUN`（未获得破坏性测试授权）。

### QA-S1-15：睡眠/唤醒后的宿主与几何恢复

- 对应：A05。
- 前置条件：已保存工作、授权测试环境、允许设备进入睡眠；持续录屏或唤醒后立即采集日志。
- 人工步骤：保存宿主与窗口边界 → 让系统进入睡眠 → 唤醒并登录 → 检查宿主关系、可见性、焦点和边界 → 必要时使用重试入口。
- 客观证据：睡眠/唤醒时间、系统事件、前后状态 JSON、窗口边界、恢复日志和已检查截图。
- PASS：唤醒后恢复真实宿主和可见边界，或明确显示失败/fallback 并提供重试；不抢焦点。
- FAIL：静默变成悬浮窗、离屏、抢焦点、崩溃或无法重试。
- 初始状态：`NOT_RUN`（未获得破坏性测试授权）。

## 7. 执行顺序与停止条件

1. Lead 通知 Desktop 实现完成并冻结本阶段接口后，QA 先做 QA-S1-01—04；编译或诊断失败先记录 `FAIL`/`BLOCKED`，不改生产代码。
2. 自动检查可运行后，再用独立 userData 执行 QA-S1-02、08—10 和当前 DPI 基线。
3. 只有原生 inspect 确认真实宿主时才执行并判定 QA-S1-05—07、11；fallback 只能验证降级区分。
4. Win+D 必须人工执行；当前能力不能自动发送 Windows 键，未获人工证据时 QA-S1-05 保持 `NOT_RUN`。
5. DPI 变更、多屏移除、Explorer 重启和睡眠需要匹配环境或明确授权；无条件时保持 `NOT_RUN`，不得推测通过。
6. 任一结果若显示 Explorer 注入、管理员常驻、静默 fallback、窗口置顶冒充桌面或不可恢复的数据/系统影响，立即停止相关破坏性测试并报告 Lead。

## 8. 待 Lead 确认的测试接口与材料

- 提供可重复的强制 fallback 启动开关，以及隔离测试 userData 的启动方式。
- 提供结构化 `DesktopHostStatus` 日志或 QA 可调用的只读状态入口；原生 attach 后必须支持独立 inspect。
- 明确状态保存去抖时长、恢复周期和正常退出方式，以便持久化/恢复测试不依赖猜测等待。
- 壳层保留可观测的交互测试按钮、拖动区和 `no-drag` 区；计数器只用于阶段 1 诊断。
- 明确后续 QA 是否获得使用 Windows GUI 的人工配合，以及是否有授权的多屏/DPI、Explorer 重启和睡眠测试环境。

强制 fallback、隔离 userData、结构化状态、自动退出和诊断按钮已经具备。Windows GUI 人工配合、多 DPI/多屏及破坏性测试授权仍未提供；对应项目保持 `NOT_RUN`。

## 9. 执行记录（QA-S1-exec，2026-09-15）

### 9.1 实际环境与命令

| 检查 | 状态 | 客观结果 |
| --- | --- | --- |
| `node --version`、`npm --version`、`python --version`、Electron `--version` | PASS | 退出 0；Node v22.13.1、npm 10.9.2、Python 3.10.9、Electron v44.3.0 |
| `npm run check` | PASS | 最终执行退出 0；`tsc --noEmit` 无错误 |
| `npm run test:platform` | FAIL | 退出 1；脚本内 `electron-vite build` 成功，Vitest 共 4 项：2 PASS、2 FAIL；失败均包含 480×420 精确几何断言 |
| 定向运行 bridge 与配置检查 | PASS | `node_modules/.bin/vitest.cmd ... -t 'Python bridge rejects|frozen configuration'` 退出 0；2 PASS、2 SKIP |
| QA 临时资源清理检查 | PASS | 完整运行后 `%TEMP%/quietdesk-platform-*` 剩余目录 0；命令行指向本工作区的 Electron 进程 0 |

本轮实际运行了三次完整平台脚本：第一次发现几何偏差；第二次输出完整状态并确认隔离状态文件；第三次在 Electron 存活期间增加独立 native `inspect`。三次完整脚本均因同一类精确几何问题退出 1，没有降低断言。

### 9.2 自动检查结果

| 范围 | 状态 | 实际证据与边界 |
| --- | --- | --- |
| Python bridge：缺参 | PASS | 无参数调用退出 2；stdout 为单个 JSON，`action=unknown`、`success=false`、包含 Usage 错误 |
| Python bridge：非法 HWND | PASS | `inspect not-a-hwnd` 与 `attach 0` 均退出 2；stdout 为结构化 JSON，明确要求正十进制整数 |
| Python bridge：不存在 HWND | PASS | `inspect 1` 退出 1；stdout 为结构化 JSON，`targetHandle=0x1` 且错误为非活动窗口 |
| 配置与安全边界 | PASS | 静态检查确认不透明、可缩放、非置顶、启动隐藏后 `showInactive`、Electron 隔离/沙箱、固定 Python argv + `shell:false`、IPC sender 校验、原子 rename、显示器事件监听；这不是 GUI 行为通过证据 |
| 强制 fallback Electron 运行 | FAIL | 真实 Electron 正常退出，`mode=fallback`、`attached=false`、`focused=false`、`resizable=true`、`transparent=false`、`alwaysOnTop=false` 均符合；隔离状态文件存在且未访问正式 userData。但状态和文件均为 480×423，不是要求的 480×420 |
| 非强制 Electron 原生关系 | FAIL | Windows Build 22631、当前 `scaleFactor=1.5`；attach 报告 `workerw-after-defview`、父类 `WorkerW`。Electron 存活时独立 `inspect` 对同一 HWND 再次返回 `success=true`、同一 WorkerW 父句柄。窗口为 480×424，故完整用例仍失败 |

最近一次原生诊断摘要：

```text
attach:  mode=desktop, attached=true, route=workerw-after-defview,
         targetClass=Chrome_WidgetWin_1, parentClass=WorkerW,
         bounds=480x424 DIP, scaleFactor=1.5, focused=false
inspect: action=inspect, success=true, route=inspect-workerw,
         parentClass=WorkerW, parentHandle 与 attach 相同
```

该诊断只验证当前 Windows Build 22631 上的原生父子关系。WorkerW 拓扑不是稳定公共 API；它不证明 Win+D、普通窗口覆盖、任务栏/Alt+Tab 或无瞬时抢焦点。

### 9.3 用例状态更新

| 用例 | 当前状态 | 说明 |
| --- | --- | --- |
| QA-S1-01 真实宿主诊断 | NOT_RUN | attach 与存活期间的独立 inspect 原生关系子项 PASS；未通过 renderer 重试入口复核前后状态，整体不写 PASS |
| QA-S1-02 fallback 区分 | NOT_RUN | 状态/API 子项 PASS；未检查实际 Electron 窗口中的可见降级标签，整体不写 PASS |
| QA-S1-03 边界恢复与容错 | NOT_RUN | 私有边界函数无冻结测试入口；未执行合成 DPI、离屏、坏 JSON 或显示器移除组合 |
| QA-S1-04 配置/安全边界 | PASS | 已执行静态配置和进程边界检查；明确不代表 A01/A02 GUI 通过 |
| QA-S1-05 桌面露出/Win+D | NOT_RUN | 未使用 Windows 键，未进行人工 Win+D |
| QA-S1-06 普通窗口覆盖 | NOT_RUN | 未执行实际 Windows 覆盖与录屏 |
| QA-S1-07 不抢焦点 | NOT_RUN | 启动状态最终 `focused=false`，但没有前景 HWND 高频记录，不能排除瞬时抢焦点 |
| QA-S1-08 连续缩放/拖动 | NOT_RUN | 未进行鼠标连续缩放或拖动；自动烟雾发现默认高度偏差 |
| QA-S1-09 交互区命中 | NOT_RUN | 未进行实际按钮点击或 drag/no-drag 命中检查 |
| QA-S1-10 跨重启持久化 | NOT_RUN | 已确认初始状态写入隔离路径，但保存为错误的 480×423；未拖到 437×386 后重启 |
| QA-S1-11 任务栏/Alt+Tab | NOT_RUN | 未打开任务栏或 Alt+Tab 视图 |
| QA-S1-12 当前 DPI 视觉基线 | NOT_RUN | 仅记录当前 150% (`scaleFactor=1.5`)；未做视觉与命中检查 |
| QA-S1-13 多 DPI/多屏 | NOT_RUN | 未变更 DPI、切屏或移除显示器 |
| QA-S1-14 Explorer 重启 | NOT_RUN | 未获破坏性测试授权，未重启 Explorer |
| QA-S1-15 睡眠/唤醒 | NOT_RUN | 未获破坏性测试授权，未让设备睡眠 |

### 9.4 需要 Lead 修复或决定

- `FAIL`：在当前 150% DPI 环境，强制 fallback 初始外框/内容均为 480×423；真实 WorkerW 模式外框为 480×424、内容为 478×424。状态文件把 fallback 的 480×423 持久化，未满足默认 480×420 DIP。
- 首次完整执行还观察到非强制模式宽度 481 的偏差；后两次为宽度 480、高度 424，说明不能把当前补偿视为稳定恢复。
- 从代码与日志推断，初始 `requestedBounds` 可能已经包含 Windows 的 frame/DPI 调整，而同步重复 `setBounds` 未稳定抵消挂接/显示后的样式变化。具体修复方案由 Lead/Desktop 决定；QA 不修改生产实现，也不放宽精确断言。
- 修复后至少重跑 `npm run check` 和完整 `npm run test:platform`。GUI、Win+D、多 DPI/多屏及破坏性恢复项目仍需 Lead 安排实际人工环境。
