# QuietDesk 进度

更新日期：2026-09-23（Asia/Shanghai）

## 当前结论

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 阶段 0：环境与规格启动 | PASS | 需求、架构、验收路由、分工和实际环境已落盘；Git 仓库已初始化 |
| 阶段 1：Windows 桌面宿主 spike | FAIL | 可运行 Electron、WorkerW attach/inspect 和明确 fallback 已实现；150% DPI 精确默认几何失败，关键 Windows GUI 情境仍未执行 |
| 阶段 2：脚手架、契约与存储 | PASS | 三窗口安全壳、IPC v1、真实 Electron SQLite 关闭重开与 Windows portable 构建已有证据 |
| 阶段 3：核心数据与 Widget | PASS | IPC v2、事务化 Task/Note/Schedule/Draft、真实 Widget/Capture/Library、业务 E2E 和 24 张逐图视觉检查完成 |
| 阶段 4：快捷捕获与 Markdown | PASS | IPC v3、全局快捷键生命周期、事务化草稿提交、安全 Markdown、失败重试与跨窗口 Electron E2E 已完成；真实 Windows IME/系统快捷键人工项另列 NOT_RUN |
| Windows 桌面宿主验收 | NOT_RUN | 原生父子关系子项 PASS；Win+D、覆盖、任务栏/Alt+Tab、连续拖动/缩放和恢复组合没有完整证据 |
| Electron 构建 | PASS | Electron 44.4.3、Node 24.21.0、electron-vite 5.0.0；阶段 4 `check`、`build`、integration 与捕获 E2E 均退出 0 |
| SQLite / Windows 打包 | NOT_RUN | 开发 Electron 内 SQLite 3.53.4 读写/进程重启为 PASS，阶段 2 portable 构建为 PASS；发布产物内部读写仍未执行，完整项保持 NOT_RUN |
| 产品验收 A01-A28 | NOT_RUN | A07、A08、A11、A12、A13、A15、A21 已有 PASS；其余含局部证据或留待后续阶段，且 A01-A05 桌面门槛仍未完成 |

当前是连接真实 SQLite 的阶段 4 业务开发预览，不是已完成桌面小组件。核心数据、三窗口 UI、快捷捕获与安全 Markdown 可运行，但 150% DPI 几何偏差和未完成的桌面宿主 GUI 验收继续阻塞最终桌面组件结论。

## 本阶段完成项

- 完整阅读 `AGENTS.md`、`prompts/00-bootstrap.md`、`docs/PRODUCT.md`、`docs/ACCEPTANCE.md`、`docs/SOURCES.md`、README 与阶段 1-7 提示词。
- 确认目录原先不是 Git 仓库；执行 `git init -b main .`，创建无提交的 `main` 分支。未创建提交、未修改 Git 全局配置。
- 核对产品规格；现有 `docs/PRODUCT.md` 已覆盖阶段 0 产品约束，保留原文。
- 补充 `AGENTS.md` 的桌面宿主早期门槛，补强 `docs/ACCEPTANCE.md` 的 IME/非解析、可访问性、DST、当前日志更新和手写区删除边界，并添加阶段证据路由。
- 创建 `docs/ARCHITECTURE.md`，记录进程边界、桌面与 SQLite 门槛、阶段依赖和文件所有权。
- 重新打开官方资料 S1、S5-S8，并在 `docs/SOURCES.md` 记录本轮复核日期。
- 实际启动两个并行只读子 agent，Lead 汇总并复核其输出；两个 agent 均未修改文件。

## 实际环境与能力

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| 当前平台 | PASS | Microsoft Windows 11 专业版 x64，版本 10.0.22631，Build 22631；当前进程 AMD64 |
| 图形会话迹象 | PASS | `[Environment]::UserInteractive=True`，Explorer 在 Session 3 运行；这不等于执行过 GUI 验收 |
| 当前 shell | PASS | PowerShell 7.6.5，原生 Windows 工作目录；不是 WSL/Linux shell |
| WSL | PASS | 注册了 `docker-desktop` WSL2 发行版，当前停止；未用它代表 Windows 桌面行为 |
| Node / npm | PASS | Node v22.13.1，npm/npx 10.9.2 |
| Git | PASS | Git 2.51.0.windows.2；`main` 跟踪 `origin/main`；增量复核开始时 HEAD 为 `2255b2b`、共 2 个提交且工作树干净，阶段 0 初次启动时曾是无提交仓库 |
| 其他 CLI | PASS | Python 3.10.9、Ninja 1.10.2 可用；pnpm 11.19.0 来自 Codex bundled runtime，但项目约定仍使用 npm |
| Windows 原生构建线索 | PASS | Visual Studio 2022 Community 17.13.35825.156、MSBuild 17.13.15.12501、MSVC x64 14.43.34808 的 `cl.exe` 已找到 |
| Windows SDK / CMake | NOT_RUN | Windows Kits 目录只见 `UnionMetadata`，未确认完整 SDK；`cmake` 不在 PATH 且未找到 VS bundled CMake。是否阻塞 native helper 要在阶段 1 用实际构建确认 |
| Electron / SQLite | NOT_RUN | 全局 `electron` 不可用；项目无依赖、锁文件、`node_modules` 或 SQLite 驱动 |
| npm 网络 | PASS | `npm ping --registry=https://registry.npmjs.org/` 退出 0（PONG 819 ms）；到 registry.npmjs.org:443 的 TCP 检查成功 |
| 子 agent | PASS | 当前多 agent 调度器成功并行创建 Zeno 与 Volta，二者完成只读任务；官方 OpenAI 文档也说明当前 Codex 支持并行子 agent 工作流 |
| 旧兼容 agent 接口 | FAIL | 两次调用返回 `Agent type 'general-purpose' not found`；未将失败调用计为协作成果，随后改用已成功的多 agent 调度器 |
| Windows GUI 自动化 | NOT_RUN | 当前会话未提供可操作原生 Windows 桌面的计算机控制；未用浏览器预览替代 Win+D、IME、DPI 或 Shell 验证 |

## 真实 agent 分工

| 任务 | Agent | 权限与输出 | 结果 |
| --- | --- | --- | --- |
| DESKTOP-RISK-0 | Zeno (`01a0a401-45bd-7703-9439-580ed8c8afaa`) | 严格只读；评估桌面宿主、透明/缩放、`better-sqlite3` 的风险、证据和降级 | PASS：返回风险清单与阶段 1/2 验证门槛；修改文件 0 |
| QA-SCENARIOS-0 | Volta (`01a0a401-4654-71d0-862c-d103ea8e200a`) | 严格只读；把产品流程分为自动、Windows GUI 和组合验收，审查现有矩阵缺口 | PASS：返回分阶段验收与缺口；修改文件 0 |
| PHASE0-INTEGRATION | Lead | 初始化 Git，复核环境与 agent 输出，修改全局文档 | PASS：文档已落盘，最终静态检查见下节 |

两个子 agent 的结论只表示只读审查任务完成，不表示产品功能通过。Lead 未让两者修改重叠文档，并已在完成后关闭子任务。

## 文件变更

- `.git/`：阶段 0 初次启动时通过 `git init -b main .` 创建；该历史步骤当时没有提交，当前已有 2 个提交并跟踪 `origin/main`。
- `AGENTS.md`：增加桌面宿主早期门槛。
- `docs/ACCEPTANCE.md`：补充现有验收判定并添加阶段/证据路由；A01-A28 状态仍全部为 `NOT_RUN`。
- `docs/ARCHITECTURE.md`：新建阶段 0 架构、依赖和所有权基线。
- `docs/PROGRESS.md`：新建本报告。
- `docs/SOURCES.md`：记录本轮实际重新核对的官方资料范围。
- `docs/PRODUCT.md`：已核对完整，本轮未改动。

未创建应用源码、`package.json`、依赖、锁文件、数据库、日志、截图或构建产物。

## 执行命令与证据

| 命令/检查 | 状态 | 结果或证据 |
| --- | --- | --- |
| `rg --files -g '!node_modules'` | PASS | 退出 0；初始化前只有规则、规格、资料索引和阶段提示词，无应用代码 |
| `git status --short --branch`（初始化前） | FAIL | 返回“not a git repository”；该事实触发用户要求的初始化 |
| `git init -b main .` | PASS | 退出 0；输出 `Initialized empty Git repository...` |
| `Get-CimInstance Win32_OperatingSystem/Win32_ComputerSystem` | PASS | 返回 Windows 11 专业版、Build 22631、x64 |
| `wsl.exe --status`、`wsl.exe --list --verbose` 与 WSL 注册表只读查询 | PASS | 默认/唯一注册发行版为已停止的 `docker-desktop`，版本 2 |
| `node --version`、`npm --version`、`git --version` 及工具路径检查 | PASS | 版本与路径已记录在环境表 |
| Visual Studio、MSBuild、MSVC 与 Windows Kits 路径检查 | PASS | 找到 VS/MSBuild/`cl.exe`；完整 Windows SDK 和 CMake 未确认，相关构建为 `NOT_RUN` |
| `npm ping --registry=https://registry.npmjs.org/` | PASS | 退出 0，PONG 819 ms |
| `Test-NetConnection registry.npmjs.org -Port 443` | PASS | `TcpTestSucceeded=True` |
| 两个只读子 agent 并行任务 | PASS | 两个 agent 均完成并返回报告；文件修改为 0 |
| 阶段 0 文档完整性脚本 | PASS | 退出 0；5 个必需文档存在，A01-A28 共 28 个且无重复，修改文件无行尾空白并以换行结尾 |
| 最终复核脚本（修正规则后） | PASS | 退出 0；Git worktree/`main`、文档、验收编号、空白与状态措辞检查通过。第一次辅助脚本仅因匹配到 `AGENTS.md` 中禁止“预计通过”的说明文字而假阳性退出 1，未掩盖文档缺陷 |
| `git status --short --branch`（阶段 0 初次文档落盘后） | PASS | 这是历史快照：当时 `main` 尚无提交，原始提示词包和本轮文档为预期的未跟踪文件；当前状态见下方增量复核 |
| Electron、SQLite、项目脚本、Windows GUI/IME、打包 | NOT_RUN | 本阶段没有实现条件，也没有伪造命令或结果 |

截图/日志证据：`NOT_RUN`。本轮没有应用或原生桌面控制能力，因此没有生成截图；环境和命令证据保留在当前 Codex 任务记录中。

## 已知问题与下一阶段入口

- 桌面宿主、透明效果、连续缩放、DPI、多屏、焦点、Win+D 和 Explorer 恢复均未验证。阶段 1 必须在本机 Windows Build 22631 上产出最小 spike 和真实证据。
- 当前 Windows SDK/CMake 完整性不明。阶段 1 若 native helper 构建失败，应先确认并补齐所需工作负载；阶段 0 不安装或更改全局开发环境。
- Electron 与 `better-sqlite3` 的版本、ABI、ASAR/unpack 和发布包加载均未验证。阶段 2 再依据当前官方文档与实际 Electron 运行锁定版本。
- `docs/CONTRACTS.md` 按阶段 2 创建；当前不要让 Data/UI 自行发明 IPC 或数据库 schema。
- 真实中文输入法、DPI/多屏和 Explorer 重启需要后续人工或可控 Windows GUI 环境；在执行前保持 `NOT_RUN`。

下一步只进入 `prompts/01-desktop-spike.md`：由 Lead 统一最小 Electron 脚手架与依赖，Desktop 实现 `DesktopHostAdapter` spike，QA 独立设计/执行桌面测试；不提前进入业务数据或完整 UI。

## GitHub 公开发布（2026-09-15）

| 项目 | 状态 | 结果 |
| --- | --- | --- |
| 公开发布前敏感信息检查 | PASS | 对候选文件检查 GitHub token、私钥、常见密码/密钥字段、邮箱、本机用户路径和大文件，未发现待排除内容 |
| 本地忽略规则 | PASS | 新增 `.gitignore`，覆盖 Node/Electron 依赖与构建产物、SQLite 数据、日志、截图、录屏、本地环境和密钥文件 |
| 匿名提交元数据 | PASS | 仓库级作者设置为 `QuietDesk Contributors <quiet-desk@users.noreply.github.com>`；未修改 Git 全局身份 |
| GitHub 仓库 | PASS | 创建公开仓库 `Zone277/quiet-desk`，默认分支为 `main` |
| 首次推送 | PASS | `main` 已推送；GitHub API 回读的首次提交为 `534b387d58b9306b1a5aa9410ed29e241d67abb7`，作者与本地匿名元数据一致 |

本次没有应用代码、依赖安装、Electron 运行、自动化测试或 Windows GUI 验收；这些状态仍保持 `NOT_RUN`。GitHub 账户所有权本身是公开可见的，匿名元数据只避免提交记录包含本机 Git 姓名和邮箱。

## 阶段 0 增量复核（2026-09-15）

### 结论与真实分工

| 项目 | 状态 | 结果 |
| --- | --- | --- |
| 阶段 0 文档一致性 | PASS | PRODUCT 与 ARCHITECTURE 覆盖 10 项约束；ACCEPTANCE 保持 A01-A28 且补清透明降级、核心入口、捕获类型、日志内容、时间边界和范围排除 |
| Git 基线 | PASS | 复核开始时 `main...origin/main`，HEAD `2255b2b`，2 个提交，工作树干净；增量复核任务只修改阶段 0 文档，当时尚未提交 |
| DESKTOP-RISK-RECHECK-0 | PASS | Pauli (`01a0a4be-0194-7f02-a1f7-58287f23eadf`) 严格只读，发现透明证据缺口和历史 Git 快照歧义；修改文件 0、接口变化无 |
| QA-SCENARIOS-RECHECK-0 | PASS | Pasteur (`01a0a4be-029d-7280-9e1b-642adf341ff5`) 严格只读，完成需求到 A01-A28 的映射并发现证据路由分层歧义；修改文件 0、接口变化无 |
| 应用、Electron、SQLite、Windows GUI/IME 与打包 | NOT_RUN | 当前仍无应用代码、依赖或运行入口；没有用浏览器或交互会话迹象替代桌面验证 |

### 文件变更

- `docs/ACCEPTANCE.md`：补强现有条目，不增加或删除验收编号；把证据路由拆为首次验证与必要回归。
- `docs/PROGRESS.md`：区分阶段 0 初次 Git 快照和当前已提交/推送状态，记录本次真实 agent 分工、环境与检查。
- `AGENTS.md`、`docs/PRODUCT.md`、`docs/ARCHITECTURE.md`：完整复核后无需修改。

### 执行命令与证据

| 命令/检查 | 状态 | 实际结果 |
| --- | --- | --- |
| OpenAI Docs 搜索并打开 Codex subagents 页面 | PASS | 官方页面可访问；当前本地多 agent 调度也由两个成功任务实际证明 |
| `Get-Content -Raw`、`rg --files`、`git status/log` | PASS | 必需文档存在；无 `CONTRACTS.md`、`package.json`、`src/` 或 `native/`，符合阶段 0/2 边界；复核开始时 Git 工作树干净 |
| Windows、Explorer 与 WSL 注册表只读检查 | PASS | Windows 11 专业版 x64 Build 22631，交互会话与 Explorer 存在；仅注册 `docker-desktop` WSL2，未把它当桌面证据 |
| Node/npm/Git/Python/Ninja/VS 工具检查 | PASS | Node v22.13.1、npm 10.9.2、Git 2.51.0、Python 3.10.9、Ninja 1.10.2；VS 17.13.35825.156 可检测 |
| `npm ping` 与 TCP 443 | PASS | npm PONG 579 ms、退出 0；registry.npmjs.org:443 连通 |
| `cmake`、`msbuild`、`cl`、`electron` PATH 检查 | PASS | 均未在当前 PATH 找到；这是已执行的环境盘点，不代表原生构建失败，相关构建仍为 `NOT_RUN` |
| 两个只读增量复核 agent | PASS | 两个任务均完成并关闭；没有文件写入或接口变化 |
| Lead 文档与工作树检查 | PASS | 退出 0；diff 仅含 `docs/ACCEPTANCE.md`、`docs/PROGRESS.md`，`git diff --check` 通过，A01-A28 共 28 个且唯一，未生成代码、依赖、数据库、日志、截图或录屏；Git 仅提示未来可能按本机配置将 LF 转为 CRLF |

截图/日志证据：`NOT_RUN`。本轮未启动应用或 Windows GUI 控制，只有命令输出和子 agent 报告保留在当前 Codex 任务记录中。

### 已知问题与下一步

- 桌面宿主、透明/不透明实际模式、连续缩放、DPI、多屏、焦点、Win+D、Explorer 恢复全部仍为 `NOT_RUN`。
- Electron、`better-sqlite3`、Windows SDK/CMake、原生模块 ABI 与打包加载全部仍为 `NOT_RUN`。
- 没有发现阻止进入阶段 1 的确定性阻塞；下一步只执行 `prompts/01-desktop-spike.md`，不提前进入契约、数据或完整 UI 阶段。

## 阶段 1：Windows 桌面宿主与自由缩放 spike（2026-09-15）

### 本阶段完成项

- 锁定 Electron 44.3.0、electron-vite 5.0.0、React 19.3.0、TypeScript 6.0.3、Vite 7.3.6、Vitest 4.1.11，并提交 npm lockfile 所需内容；没有引入 SQLite、业务模型或打包器。
- 创建最小 main/preload/renderer：无边框、不透明、可缩放诊断窗，明确显示 `DESKTOP ATTACHED` 或 `DEVELOPMENT FALLBACK`；renderer 只经类型化 preload 使用两个受限 IPC。
- 实现 `DesktopHostAdapter`、窗口状态恢复/原子写入、显示器事件处理和宿主健康检查。Windows bridge 是固定 Python `ctypes` helper，`shell:false`，无 Explorer 注入、无管理员常驻。
- 在当前 Windows Build 22631 上真实执行 WorkerW 挂接，随后由独立 helper inspect 再次确认同一父 HWND；普通窗口配置没有被当作桌面证明。
- 用实际 Electron fallback 窗口执行窗口级自动化：可见降级标签和交互按钮，按钮点击三次后计数为 3。CSS 布局已调整，使按钮在默认高度内可见。
- 修复 TypeScript CSS 类型声明和 renderer 首次调用早于 IPC 注册的竞态；IPC 在窗口加载前注册并等待 controller promise。
- 创建 `docs/DESKTOP-SPIKE.md` 和 QA 测试计划，更新 A01-A05 的实际状态。

### 真实 agent 分工

| 任务 | Agent | 允许写入 | 实际结果 |
| --- | --- | --- | --- |
| Desktop-S1 | Epicurus (`01a0a4ec-dfb4-78e3-b466-15f6e1dbf179`) | `src/main/windows/**`、`src/main/platform/**`、`native/**` | PASS：实现三个限定文件；真实运行取得 WorkerW attach/inspect、最终 `focused=false` 和隔离状态写入证据；如实报告最后样式修复未复测、IPC 竞态及 GUI 未测项 |
| QA-S1-plan / QA-S1-exec | Carson (`01a0a4ec-e0e4-7833-b917-d3c112c41b63`) | 先仅 `docs/reviews/**`，实现冻结后扩大到 `tests/platform/**` | PASS：设计 15 个用例，执行 4 项平台测试并保留失败断言；最终 2 PASS、2 FAIL，没有修改生产代码或把未测写成通过 |
| Stage1-Integration | Lead | 根配置、依赖/锁、shared、preload、IPC、入口、最小 renderer、全局文档 | FAIL：完成集成、复测和窗口自动化，但精确几何仍失败；未用 fallback 行为冒充桌面验收 |

两个子 agent 在同一共享工作目录按不重叠所有权工作；没有默认假设独立副本，没有执行 Git 切换、提交或清理用户改动。Lead 在 agent 返回后检查了真实文件并重新运行测试。

### 文件变更

- 根配置：`.gitignore`、`package.json`、`package-lock.json`、`tsconfig.json`、`electron.vite.config.ts`、`vitest.config.ts`。
- 公共与进程边界：`src/shared/desktop-spike.ts`、`src/preload/index.ts`、`src/main/index.ts`、`src/main/ipc/desktop-spike-ipc.ts`。
- Desktop：`src/main/windows/desktop-spike-window.ts`、`src/main/platform/desktop-host.ts`、`native/windows_desktop_host.py`。
- 最小诊断 UI：`src/renderer/index.html`、`src/renderer/src/desktop-spike-api.d.ts`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`。
- QA 与文档：`tests/platform/desktop-spike.platform.test.ts`、`docs/reviews/desktop-spike-test-plan.md`、`docs/DESKTOP-SPIKE.md`、`docs/ACCEPTANCE.md`、`docs/PROGRESS.md`。

`out/`、`node_modules/`、Python `__pycache__/`、临时 userData 与截图均被忽略，没有作为源码变更。未创建提交。

### 执行命令与真实结果

| 命令/检查 | 状态 | 实际结果 |
| --- | --- | --- |
| `npm install`（系统 npm 10.9.2） | FAIL | npm Arborist 抛出 `Cannot read properties of null (reading 'edgesOut')`；未伪称安装成功 |
| `npx --yes npm@11.19.1 install` | PASS | 安装 115 个包，审计 0 漏洞；`packageManager` 锁定 11.19.1，不修改全局 npm |
| `npx --yes npm@11.19.1 install-scripts approve --all` | PASS | 固定批准 `@swc/core@1.16.2` 和两版锁定的 esbuild；随后无未审查脚本 |
| `npx electron --version` / electron-vite / TypeScript | PASS | v44.3.0 / 5.0.0 / 6.0.3，均退出 0 |
| `npm run check`（Lead 最终） | PASS | 退出 0；早期一次因 CSS 副作用导入缺少 Vite 类型而失败，修复后重跑通过 |
| `npm run build` | PASS | 退出 0；main、preload、renderer 均构建成功 |
| Python bridge 非法输入 | PASS | 缺参、非数字、0 和不存在 HWND 均返回单条 JSON 与预期非零退出码 |
| 真实 Electron desktop 启动 | PASS | 当前 Build 22631、150% / DPI 144；`mode=desktop`、`attached=true`、route `workerw-after-defview`、父类 WorkerW |
| 独立 native inspect | PASS | Electron 存活时退出 0，回读同一父句柄和 `parentClass=WorkerW` |
| `npm run test:platform`（Lead 最终） | FAIL | 构建通过；Vitest 4 项中 2 PASS、2 FAIL，退出 1。fallback 480×423、desktop 482×424，未满足 480×420 精确断言 |
| fallback 交互按钮 | PASS | 实际窗口截图检查；连续点击 3 次，按钮显示 `Interaction count: 3`，没有移动窗口 |
| CSS 标题拖动和边缘缩放 | NOT_RUN | 窗口级自动化的 drag 没有产生可判定动作，且目标坐标不能超出当前窗口；不能据此判断产品 PASS/FAIL |
| Win+D、任务栏/Alt+Tab、普通窗口覆盖 | NOT_RUN | 当前自动化规范禁止发送 Windows 键，且 WorkerW 子窗口不在可选顶层窗口清单；未用 fallback 代替 |
| 100%/200% DPI、跨屏/移除显示器 | NOT_RUN | 只记录当前 150%；未授权更改用户显示环境 |
| Explorer 重启、睡眠/唤醒 | NOT_RUN | 可能中断用户工作，未获授权，不执行 |

截图证据位于当前 Codex 任务的 Windows 窗口工具记录：一张显示默认 fallback 布局与可见按钮，一张显示 `Interaction count: 3`。未保存到仓库。机器可读诊断通过 `QUIETDESK_DESKTOP_STATUS` 输出，详细摘要见 `docs/DESKTOP-SPIKE.md`；QA 的命令和用例证据见 `docs/reviews/desktop-spike-test-plan.md`。

### 已知问题与下一阶段入口

- `FAIL`：当前 150% DPI 下 Electron frameless thick frame 与 reparent 后的 bounds 存在 3–4 DIP 高度、desktop 额外 2 DIP 宽度偏差，且偏差写入状态文件。没有删除 QA 精确断言；需要后续决定采用 DWM 可见边界归一化、原生 resize hit-test，或其他不牺牲连续缩放的方案。
- `NOT_RUN`：Win+D、普通窗口覆盖、任务栏/Alt+Tab、瞬时焦点、实际鼠标连续拖动/缩放、跨重启非预设尺寸、100%/200% DPI、多屏、Explorer 重启、睡眠。
- Python helper 在本机可用但不是自包含发布依赖；`native/` 尚无 electron-builder 资源规则，打包验证为 `NOT_RUN`。
- QA 创建的临时目录已由测试清理。Lead 创建的若干 `QuietDesk-stage1-*` 隔离 userData 位于系统 `%TEMP%`、仓库外；递归清理请求被安全策略拒绝，未绕过。它们不是真实用户数据，也不会被 Git 收录。
- WorkerW/Progman/SHELLDLL_DefView 是非公开 Shell 结构。即使当前 attach/inspect 为 PASS，也必须保留健康检查、重试和明确 fallback；最终不能将其描述为稳定 Windows API。
- 阶段 2 的纯业务契约/数据工作可以继续，但不得把阶段 1 写成完成的桌面组件。若后续阶段需要桌面回归，先按 `docs/DESKTOP-SPIKE.md` 的人工步骤补齐 A01-A05 证据。

本轮到此停止，不提前实现完整业务、SQLite、Markdown、主题、快捷捕获或打包。

## 阶段 2：稳定脚手架、公共契约与真实存储烟雾（2026-09-21）

### 本阶段完成项

- 冻结 `docs/CONTRACTS.md` 和 `src/shared` v1：Task、Note、Timed/All-day Schedule、Draft、Daily Log、应用时区、可注入 Clock、UTC/date-only 边界、同日完成后重开、删除传播与草稿提交事务。
- 建立 main/preload/renderer/shared/domain/data/services 分层；preload 只暴露 bootstrap、Note 烟雾读写和变更订阅，不提供通用 IPC、SQL、路径或 shell。
- Widget 沿用阶段 1 `DesktopHostAdapter`；新增 Capture/Library 安全空壳。普通启动只显示 Widget，测试模式以 `showInactive()` 显示三窗口且不聚焦。
- 使用 `node:sqlite` 建立 user_version 迁移、参数化 Note 存取、幂等回执、单调 change sequence 和持久化应用时区；正式、开发、demo、测试目录从启动前分离。
- 在真实 Electron 44.4.3 中完成空库迁移、中英文写入、同进程关闭重开、第二 Electron 进程重启读回；三窗口 E2E 验证安全边界和提交后跨窗口 revision 刷新。
- 建立并真实执行 `dev`、`check`、`test:integration`、`test:e2e`、`build`、`dist:win` 脚本中的可结束命令；`dist:win` 产出 101,040,526 字节 portable 文件。交互式 `dev` 脚本未在本轮保持长驻运行，但不是空命令。

### 真实 agent 分工

| 任务 | Agent | 允许写入 | 实际结果 |
| --- | --- | --- | --- |
| DATA-S2-DISCOVERY / IMPLEMENT | Nietzsche (`01a0c2e5-d12b-7a03-a104-4f52d7777dba`) | 先只读；冻结后 `src/domain/**`、`src/main/data/**`、`src/main/services/**`、`tests/data/**` | PASS：只读提出最小操作；随后实现 `node:sqlite` 服务和 8 个测试，未修改公共契约/依赖 |
| UI-S2-DISCOVERY / IMPLEMENT | Pascal (`01a0c2e5-d265-7c30-afb1-6c3fc860c7b6`) | 先只读；冻结后 `src/renderer/**` | PASS：只读提出三窗口读取/订阅需求；随后实现三个入口、安全 CSP 和明确 NOT_IMPLEMENTED 空壳，未修改主进程/契约 |
| Stage2-Integration | Lead | 根配置/锁、shared、preload、IPC、主入口、集成/E2E、全局文档 | PASS：先冻结契约，串行处理 SQLite 候选与安装，再检查 agent 实际文件、集成并重新运行全部阶段 2 门槛 |

两个子 agent 使用同一共享工作目录但写入范围不重叠；Lead 在原生依赖候选安装结束后才开放实现任务，没有并行重建同一个 `node_modules`。所有 agent 已关闭。

### 依赖与 SQLite 选择

- npm registry 实际查询并锁定：Electron 44.4.3、electron-vite 5.0.0、Zod 4.6.5、Playwright 1.63.0、electron-builder 26.15.3；沿用相容的 React 19.3.0、TypeScript 6.0.3、Vite 7.3.6、Vitest 4.1.11。
- `better-sqlite3@13.0.3` 优先候选实测为 `FAIL`：`electron-builder install-app-deps` 对 Electron 44.4.3/x64 转入 node-gyp，当前机器没有 node-gyp 可用的 Visual Studio C++ 工具链，安装退出 1。未修改全局环境。
- 改用 Electron 随附 Node 24 的内置 `node:sqlite`。Node 22.13.1 运行 Data 测试时打印 experimental warning，所以 Node 测试只作补充；真实门槛由 Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4 通过。

### 文件变更

- 根与构建：`.gitignore`（将根数据目录规则锚定，避免误忽略源码 `data/`）、`package.json`、`package-lock.json`、`electron.vite.config.ts`、`tsconfig.json`。
- 契约：`docs/CONTRACTS.md`、`src/shared/model.ts`、`clock.ts`、`ipc-channels.ts`、`ipc-contract.ts`。
- 主进程：`src/main/index.ts`、`app-shell-windows.ts`、`ipc/quietdesk-ipc.ts`、`ipc/window-registry.ts`；阶段 1 windows/platform/native 文件未另起实现。
- Data：`src/domain/storage-errors.ts`、`src/main/data/quietdesk-database.ts`、`src/main/services/note-storage-service.ts`。
- Preload/UI：`src/preload/index.ts`；三 HTML 入口及共享 React shell/CSS/声明。
- 测试：`tests/contracts`、`tests/data`、`tests/integration/electron-storage-smoke.mjs`、`tests/e2e/windows-shells.mjs`。

### 执行命令与真实结果

| 命令/检查 | 状态 | 实际结果 |
| --- | --- | --- |
| npm registry 版本查询 | PASS | 候选版本与 Node 要求可读取；最终版本写入 lockfile |
| 首次 `npx npm@11.19.1 install`（含 better-sqlite3） | FAIL | rebuild 转入 node-gyp 后报 `Could not find any Visual Studio installation to use`，退出 1；未误报为兼容 |
| 移除失败候选后的 `npx npm@11.19.1 install` | PASS | 退出 0；移除 3 个包，审计 389 个包、0 漏洞 |
| `npm run check` | PASS | 退出 0；TypeScript 与 5/5 公共契约测试通过 |
| `npx vitest run tests/data` | PASS | 退出 0；8/8：迁移、Unicode、幂等回放/冲突、sequence、关闭重开和时区持久化 |
| `npm run build` | PASS | 退出 0；main、preload、Widget/Capture/Library 三 HTML 构建成功 |
| `npm run test:integration` | PASS | 退出 0；两次真实 Electron 进程读写同一隔离临时库，Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4，revision=1 |
| `npm run test:e2e` 首次 | FAIL | 测试 locator 同时命中 html/body/main；未降低产品断言，收紧 selector 后重跑 |
| `npm run test:e2e` 最终 | PASS | 退出 0；三窗口、安全偏好、无 renderer Node 全局、负向 IPC、真实 Note、跨窗口 revision=1、交互按钮通过 |
| `npm run test:platform` | FAIL | 退出 1；阶段 1 已知精确几何仍失败：fallback 480×423、desktop 482×424；其余 2 项通过，WorkerW attach/inspect 与 focused=false 仍有日志 |
| `npm run dist:win` | PASS | 退出 0；`release/QuietDesk 0.1.0.exe` 生成（portable x64，101,040,526 字节），使用默认 Electron 图标且 package author 缺失的警告不影响构建 |
| `git diff --check` | PASS | 无空白错误；仅有本机 LF/CRLF 提示 |

所有 Electron/E2E 数据位于测试 harness 新建的 `%TEMP%/quietdesk-*` 目录，并由脚本安全清理；没有接触正式 userData。`out/`、`release/`、SQLite、日志和截图均被忽略。

### 未验证、已知问题与下一阶段入口

- `NOT_RUN`：portable/打包产物内部的 SQLite 写读与重启；虽然构建成功，A24 完整结论留到阶段 6。
- `NOT_RUN`：真实 Windows IME、Markdown 安全渲染、草稿生命周期、完整 Task/Note/Schedule CRUD、Daily Log、删除传播、导出、主题和全局快捷键；这些能力没有出现在阶段 2 空壳里。
- `NOT_RUN`：阶段 1 人工桌面项（Win+D、普通窗口覆盖、任务栏/Alt+Tab、连续鼠标缩放、多屏/DPI 组合、Explorer 重启、睡眠）；桌面组件完成结论仍被阻塞。
- `FAIL`：阶段 1 在当前 150% DPI 的精确 480×420 几何回归仍失败。本阶段没有修改 Desktop 适配器或降低测试断言。
- `node:sqlite` 将运行时依赖绑定到 Electron 所带 Node 版本；升级 Electron 时必须重跑 schema/读写/重启测试。阶段 6 还需验证发布产物、中文/空格路径和离线启动。
- 阶段 3 入口：沿用 CONTRACTS v1，由 Data/UI 在现有所有权下实现任务、笔记和日程核心闭环；任何共享类型或 IPC 扩展先由 Lead 更新契约。

本轮到此停止，不提前实现阶段 3 业务。

## 阶段 3：核心数据层与 Widget 界面（2026-09-21）

### 本阶段完成项

- Lead 先将 IPC/模型契约升级并冻结为 v2，再开放不重叠写入目录；Data、UI 与 QA 最多三个 agent 同时工作，公共类型、preload、IPC、依赖和锁文件始终由 Lead 维护。
- Data 实现 Task、Note、Timed/All-day Schedule、Draft 的创建/编辑、完成/重开/改期、按日查询、当前/未来任务、回收站/恢复/确认永久删除、操作快照和事务化变更事件。SQL 值全部参数化；永久删除清除应用管理的关联正文。
- UI 实现原创 Sonoma 氛围的 Widget、Capture、Library，连接真实 preload API；支持中文/英文、浅色/深色/跟随系统、日期浏览、折叠的今日已完成，以及 320×240、480×420、720×720 和 437×386 非预设尺寸。
- Lead 集成全部 v2 handler、运行时校验、请求幂等、乐观 revision、提交后跨窗口事件、窗口日期上下文与 Electron `nativeTheme`。Renderer 不接触 Node、SQLite、文件系统、任意 IPC 或 shell。
- 测试使用隔离临时 userData 和固定上海时区 Clock，真实证明中文任务跨 Electron 进程恢复、完成历史、重开、昨日任务不改期、跨午夜与全天日程双日可见、真实 SQLite 写锁回滚/重试，以及压力数据下四种尺寸的核心入口。
- 最终视觉矩阵为 4 尺寸 × 3 主题 × 2 语言，共 24 张 PNG；Lead 逐张实际打开检查并在同目录写入审查记录。测试产物被 Git 忽略，没有混入源码提交。

### 真实 agent 分工

| 任务 | Agent | 允许写入 | 实际结果 |
| --- | --- | --- | --- |
| DATA-S3-DISCOVERY / IMPLEMENT | Avicenna (`01a0c312-5561-7362-b5d6-41836ac1c7b6`) | 先只读；冻结后仅 `src/domain/**`、`src/main/data/**`、`src/main/services/**`、`tests/data/**` | PASS：实现 schema v2、CoreDataService、事务/历史/回收站与 19 个 Data 测试；未改公共契约、preload、IPC 或依赖 |
| UI-S3-DISCOVERY / IMPLEMENT | Raman (`01a0c312-5689-7da3-9372-fee4a8106849`) | 先只读；冻结后仅 `src/renderer/**` 及局部 UI 测试 | PASS：实现三窗口真实 API 界面、tokens、国际化、主题和响应式布局；未引入 mock/localStorage 作为产品路径 |
| QA-S3-DESIGN / IMPLEMENT | Peirce (`01a0c312-57c0-7b80-9854-81504a46aad9`) | `tests/e2e/**`、`tests/platform/**`、`docs/reviews/**`；不改生产代码 | PASS：独立设计并实现真实 Electron 业务/视觉 harness；先如实报告 handler 未接线时的 FAIL，Lead 集成后由 Lead 完成最终复跑与逐图检查 |
| Stage3-Integration | Lead | 根配置、`src/shared/**`、`src/preload/**`、`src/main/ipc/**`、主入口、全局文档 | PASS：冻结契约、接线 Data/UI、修复时区/草稿/小尺寸/安全测试问题，复核 agent 文件并提交推送所有增量 |

三个子 agent 在同一工作目录按文件所有权工作，没有默认假设独立副本；没有并行重建原生依赖。所有 agent 在 Lead 集成前后均已等待并关闭。

### 文件变更

- 契约与边界：`src/shared/model.ts`、`ipc-channels.ts`、`ipc-contract.ts`、`src/preload/index.ts`、`docs/CONTRACTS.md`。
- Data/domain：`src/domain/**`、`src/main/data/**`、`src/main/services/**`、`tests/data/**`。
- 主进程集成：`src/main/index.ts`、`src/main/ipc/**`、窗口上下文与主题接线；沿用阶段 1 `DesktopHostAdapter`，没有创建第二套宿主。
- UI：`src/renderer/**` 的 Widget、Capture、Library、设计 tokens、locale/theme 与真实 API hooks。
- QA：`tests/e2e/stage3-harness.mjs`、`stage3-business.mjs`、`stage3-visual.mjs`，以及阶段 2 窗口安全回归整合。
- 构建/文档：`package.json` 脚本、`docs/ACCEPTANCE.md`、`docs/PROGRESS.md`、`docs/reviews/stage3-test-plan.md`。

### 执行命令与真实结果

| 命令/检查 | 状态 | 实际结果 |
| --- | --- | --- |
| `npm run check` | PASS | 退出 0；TypeScript 与 7/7 公共契约测试通过 |
| `npx vitest run tests/data` | PASS | 退出 0；2 个文件、19/19，用固定 Clock 覆盖 CRUD、事务、历史、查询、草稿和删除 |
| `npm run test:integration` | PASS | 退出 0；两个独立 Electron 进程对同一隔离库写入/关闭/重开/读回；Electron 44.4.3、Node 24.21.0、SQLite 3.53.4 |
| `npm run test:e2e`（最终） | PASS | 退出 0；窗口安全回归和阶段 3 业务均通过；最终业务运行使用 3 个独立 PID，并覆盖 160 个任务、60 个日程、40 个笔记的压力数据 |
| 阶段 3 业务 E2E 的过程性运行 | FAIL | 集成前先因 20 个 v2 handler 未接线退出；集成中另有一次页面在压力播种期间意外关闭。未降低断言；修复/重跑后的完整最终命令为 PASS |
| `npm run build` | PASS | 退出 0；main、preload 和 Widget/Capture/Library 全部构建成功 |
| 阶段 3 视觉生成 | PASS | 最终 run `test-results/stage3/2026-09-21T09-19-37-659Z-b79cf055` 生成 24/24；manifest 记录 Electron/Node/SQLite、150% 缩放、内容尺寸和 SHA-256 |
| 阶段 3 视觉逐图检查 | PASS | 24/24 PNG 均以图像工具实际打开；`visual-review.md` 与 manifest 逐项为 PASS，无水平溢出，四个核心入口在最小尺寸可发现，浅/深/system 与中英文可读 |
| 320×240 几何 | PASS | 当前 150% 缩放下请求 320×240、实际内容 320×241；harness 仅允许并记录 Windows/Electron 1 DIP 舍入，超过 1 DIP 会失败 |
| `npm run test:platform` | FAIL | 本阶段末重新执行，退出 1、2/4 通过：Windows Build 22631、150% 下 fallback 480×423、desktop 482×424，仍不满足精确 480×420；没有修改 Desktop 适配器或把普通窗口当宿主 |
| `npm run dist:win`（本阶段） | NOT_RUN | 阶段 2 曾成功生成 portable；阶段 3 未重新打包或在发布产物内执行新业务 SQLite 闭环 |

所有运行数据位于 harness 创建的隔离目录；正式数据未被访问。最终视觉证据位于被忽略的本地路径 `test-results/stage3/2026-09-21T09-19-37-659Z-b79cf055/`，不会随 Git 推送。

### GitHub 增量交付

本阶段功能按增量提交并推送到 `origin/main`：

- `6fca746`、`08163cb`：恢复/补充工程契约和独立 QA 计划。
- `6f57eb9`、`213941b`：冻结 IPC v2 与强制显式乐观 revision。
- `e1bff66`：加入真实 Electron 阶段 3 验收 harness。
- `c2c7b74`：事务化阶段 3 Data/domain。
- `181d43e`：三窗口阶段 3 UI。
- `0a2fe81`：Lead IPC、窗口更新、时区、安全与最终业务集成。

### 未验证、已知问题与下一阶段入口

- `FAIL`：阶段 1 的 150% DPI 精确桌面窗口几何回归仍失败；`NOT_RUN`：Win+D、普通窗口覆盖、任务栏/Alt+Tab、真实鼠标连续拖动/缩放、多屏/DPI 组合、Explorer 重启与睡眠。阶段 3 PASS 不能替代这些证据。
- `NOT_RUN`：Windows 系统外观在应用运行时实时切换、真实中文输入法候选确认、Ctrl+Enter 提交、全局快捷捕获和 Markdown 预览；这些属于后续阶段。
- `NOT_RUN`：Capture 在真实存储失败时的“可见输入仍保留”截图。真实 SQLite 写锁下事务回滚、无事件和释放后重试为 PASS，但 UI 触发链没有视觉证据。
- `NOT_RUN`：QA 扩展截图中的 Capture/Library 空状态、保存失败、键盘焦点、今日已完成展开态与 100%/200% DPI；本轮 24 张 Widget 基础矩阵已经逐图检查，但不冒充这些扩展状态。
- `NOT_RUN`：Daily Log 生成、补生成、Markdown 导出和日志删除传播；阶段 3 只提供后续历史还原需要的稳定操作快照。
- `node:sqlite` 仍打印实验性警告；Electron 升级及阶段 6 打包产物必须重新执行读写、重启、中文/空格路径和离线测试。
- 下一阶段入口是阶段 4：在现有草稿/实体事务与真实 UI 上完成快捷捕获、IME/Ctrl+Enter 行为和安全 Markdown 预览，不提前实现阶段 5 Daily Log。

本轮到此停止，不提前执行阶段 4。

## 阶段 4：快捷捕获与 Markdown（2026-09-23）

### 完成项与真实分工

- Lead 冻结 IPC v3，独占 `src/shared/`、`src/preload/`、`src/main/ipc/`、主入口与依赖锁定，并集成跨窗口 change event、窗口授权和受限外链。Markdown 依赖锁定为 `react-markdown@10.1.0`、`remark-gfm@4.0.1`。
- Desktop agent Kierkegaard (`01a0c8e7-374c-7920-bdde-9755b1b5d1b0`) 只修改 `src/main/windows/`、`src/main/platform/` 及局部测试，实现默认全局快捷键、冲突状态、重配回滚与 Capture 关闭转隐藏。
- Data agent Carson (`01a0c8e8-043a-71e1-9e70-65cd9a4883ca`) 只修改主进程数据/服务与局部数据测试，实现草稿到笔记、任务和两类日程的原子提交、历史/change/幂等回执、草稿清理和快捷键持久化。
- UI agent Nash (`01a0c8e7-3859-7dc2-aade-5c5769abe396`) 只修改 `src/renderer/` 与局部测试，实现默认笔记、显式类型切换、800 ms 去抖草稿、单写入在途、revision/editSeq、防重复提交、Esc 保存收起、失焦保留、composition 判断、Markdown 源码/预览与 Library 阅读。
- Desktop/UI 只读勘察 agent Wegener (`01a0c8da-1da8-7831-afeb-0daf80c5277a`) 与 Lorentz (`01a0c8da-1e93-7961-aa28-3c5431ac11e7`) 提供接口需求；修改文件 0。
- 最终 QA agent Linnaeus (`01a0cc05-4e94-7d92-bb15-83cf45bdc984`) 新增 `tests/e2e/stage4-capture.mjs`、`docs/reviews/stage4-capture-qa.md`，并扩展 `tests/e2e/stage3-harness.mjs` 的隔离测试环境参数。它最初把 harness 修改误报为既存改动，Lead 通过 Git diff 纠正。首次 QA agent Gibbs 长时间未产出文件，已关闭，不计入通过证据。
- Lead 在隔离测试 userData 下增加显式一次性提交故障注入，并复测失败后保留输入、草稿与窗口，以及重试成功且不重复创建；正式运行路径不启用该注入。

### 文件与提交

主要变更：`docs/CONTRACTS.md`、`src/shared/`、`src/preload/`、`src/main/index.ts`、`src/main/ipc/quietdesk-ipc.ts`、`src/main/platform/global-shortcut-manager.ts`、`src/main/windows/capture-window-controller.ts`、`src/main/services/core-data-service.ts`、`src/renderer/src/`、`tests/data/`、`tests/platform/`、`tests/e2e/`、`package.json` 与锁文件。QA 详细逐项证据见 `docs/reviews/stage4-capture-qa.md`。

阶段 4 功能和测试已增量提交并推送 `origin/main`：`27331b6`、`7c86b31`、`b39d63c`、`249a692`、`d215f9b`、`1a9e266`、`30c3b75`。本节进度与验收矩阵另作最终文档提交。

### 最终命令与结果

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| `npm run check` | PASS | 退出 0；TypeScript 与 9/9 契约测试通过 |
| 阶段 4 相关 Vitest | PASS | 6 个文件、50/50 测试通过，覆盖 Data、快捷键、Capture 生命周期和 Markdown 组件 |
| `npm run test:integration` | PASS | 退出 0；实际 Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4 在隔离 userData 写入、关闭、重开、读回 |
| `npm run test:e2e`（正式脚本回归） | PASS | 退出 0；构建三个窗口，依次输出 `E2E_WINDOWS_SECURITY_PASS`、`STAGE3_BUSINESS_PASS`、`STAGE4_CAPTURE_PASS`；Stage 4 两个隔离目录均输出 `removed:true` |
| Stage 4 E2E 独立复跑 | PASS | Lead 重新 build 后运行及再次直接运行均退出 0；默认笔记、多行、Esc/失焦/重启、跨窗刷新、乱序保存、失败重试、快速双 Ctrl+Enter、Markdown 安全和快捷键冲突均有断言 |
| 事务回滚 | PASS | Data 测试使用 SQLite trigger 在晚期删除草稿时制造失败，证明实体、历史、change、回执和草稿删除全部回滚 |
| 150% DPI 平台回归 | FAIL | `tests/platform/desktop-spike.platform.test.ts` 4 项中 2 项失败：fallback 480×423、原生 desktop 482×424，不满足 480×420 精确几何；未降低断言 |
| 真实中文 IME 候选确认 | PASS | Lead 在 Windows Build 22631 的隔离 Electron Capture 窗口，以原生窗口控制逐键输入 `ni` 并观察系统候选栏；空格确认后正文出现 `你`，窗口保持打开。再输入 `hao`，候选栏在场时按 Ctrl+Enter，窗口未提交或清空；随后仍可确认汉字。工具截图与可访问性树保留在本任务记录，这与 DOM composition 模拟分开 |
| 真实 OS 快捷键按键唤起 | NOT_RUN | 已测注册状态、冲突、改键、持久化与 Widget 回退入口；未实际发送系统级组合键 |
| SQLite 持续写锁下的 UI 故障重试 | NOT_RUN | QA 过程性运行不稳定；确定性 UI 故障与 Data 事务回滚分别有证据，不等同于该组合情境 |
| Capture/Library 截图人工检查、外部浏览器实际打开、发布产物运行 | NOT_RUN | 原生 IME 检查查看了 Capture 截图，但未完成全布局视觉矩阵；外链 E2E 只验证主进程 URL 规则并在隔离测试中抑制系统浏览器打开 |

阶段 4 的自动化闭环为 PASS，但产品仍是开发预览。阶段 1 的几何 FAIL 与 Win+D、普通窗口覆盖、任务栏/Alt+Tab、自由拖动缩放、多屏、Explorer/睡眠组合的 NOT_RUN 继续阻止“桌面组件完成”的结论。阶段 5 入口是 Daily Log 与导出；本轮未提前实现。

Lead 随后扩充 `tests/e2e/stage4-capture.mjs`：通过 Capture UI 显式创建 Task、跨午夜定时日程和多日全天日程，并在 Widget/Library 查询验证；笔记中的 Markdown 清单与“明天上午九点”文本没有派生 Task/Schedule。扩充后脚本复跑退出 0，两个隔离 userData 均输出 `removed:true`。另以独立 `%TEMP%/quietdesk-ime-9daaf8723b50488b949d240a398da7e2` 运行真实 IME 检查；Electron 实例已停止，清理命令被执行策略拒绝，目录是否仍存在未再确认，正式 userData 未访问。

## 阶段 5：Daily Log、日期历史与删除传播（2026-09-24）

### 完成与真实分工

- Lead 先收集 Data/UI/QA 三个只读方案，再冻结 `docs/CONTRACTS.md` §12 与 IPC v4；独占公共类型、preload、IPC、主入口和脚本。三个 agent 在共享目录仅修改各自范围，未假定独立 worktree，也未提交 Git。
- Data agent Averroes (`01a0d16c-51e8-74a2-b16f-028fdf524438`) 仅修改 `src/domain/**`、`src/main/data/**`、`src/main/services/**`、`tests/data/**`：schema v3、操作快照重建、四类自动项、独立手写 revision/幂等、跨日补生成、回收站过滤/恢复与永久删除关联正文清理。
- UI agent Ptolemy (`01a0d16c-5310-7c40-886f-81f9a8682881`) 仅修改 `src/renderer/**`：Library 日期 Daily Log、源码/预览、保存/冲突/失败、导出状态、独立副本提示、中英文与响应式样式及组件测试。
- QA agent Singer (`01a0d16c-5443-74e3-97cc-df5bc5414b03`) 仅修改 `tests/e2e/**` 与 `docs/reviews/**`：独立 A/B/C、跳日、零点、同日重开、删除/恢复/永久删除、实际 UTF-8 文件字节、IPC 授权/取消测试。详细记录见 `docs/reviews/stage5-daily-log-qa.md`。
- Lead 接入 `dailyLogs.get/saveManual/export`，仅 Library 可用；原生保存对话框返回路径不进 renderer。导出在用户选择目标后重新从 SQLite 生成最新 Markdown。启动与唤醒调用补生成；测试独立 userData 与固定 Clock/时区，未触碰正式数据。

### 最终命令与证据

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| `npm run check` | PASS | 退出 0，TypeScript 与契约测试 10/10 |
| `npx vitest run tests/data` | PASS | 最终 4 文件 40/40；真实 SQLite，覆盖历史日界线、同时间戳序、同日重开、手写幂等/冲突、DST、停机补生成与删除正文清理 |
| `npx vitest run --config src/renderer/vitest.config.ts` | PASS | 退出 0，2/2 组件测试；不代表原生窗口视觉验收 |
| `npm run test:integration` | PASS | 退出 0；Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4，在隔离目录写入、关闭重开、读回 |
| `npm run test:e2e` | PASS | 退出 0；阶段 2–5 标记全部输出。Stage 5 经过四个独立 Electron PID、固定上海时区、真实 preload/IPC/SQLite 和重启 |
| 最终 `node tests/e2e/stage5-daily-log.mjs` | PASS | 退出 0；Data agent 停止写入后独立复跑，`STAGE5_DAILY_LOG_PASS`，导出 UTF-8 文件 278 字节；临时 userData 由 harness 清理 |
| `git diff --check` | PASS | 退出 0；只有 Windows LF/CRLF 提示，无空白错误 |
| 真实 Windows 原生保存对话框鼠标/键盘操作 | NOT_RUN | E2E 在测试进程内限定 `dialog.showSaveDialog` 返回值；文件写入、取消、安全边界为 PASS，但未冒充真实对话框人工验收 |
| 本轮 Library 实际截图逐图视觉检查 | NOT_RUN | 组件与 Electron 交互断言不等于视觉审查 |
| 阶段 1 桌面宿主/精确几何与发布产物内 SQLite | FAIL / NOT_RUN | 150% DPI 精确 480×420 历史 FAIL 未重测；Win+D 等宿主人工项及 Stage 5 打包产物运行 NOT_RUN |

阶段 5 自动业务闭环完成，但产品仍标为“开发预览，桌面验收未完成”。已导出的 Markdown 与外部备份是独立副本；后续删除只保证应用管理的自动日志和新导出不再含被删正文。下一阶段入口为阶段 6 打包与发布行为，先处理桌面宿主的未验证项；本轮不提前实施。
