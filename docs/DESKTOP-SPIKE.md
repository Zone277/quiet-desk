# QuietDesk Windows 桌面宿主可行性验证

## 范围与结论规则

本文件只记录阶段 1 的系统窗口风险验证。真实桌面模式必须由原生诊断证明 Electron 窗口已成为 Windows Shell 桌面层的子窗口，并回读到允许的父窗口类；`alwaysOnTop: false`、`skipTaskbar: true` 或普通无边框窗口本身都不能证明桌面语义。无法建立或确认宿主关系时，程序必须显示 `DEVELOPMENT FALLBACK`，不能宣称桌面组件完成。

状态仅使用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。本阶段不验证完整业务、透明/磨砂效果、安装包或原生 SQLite。

## 候选方案

| 方案 | 用途 | 阶段 1 决定 |
| --- | --- | --- |
| 普通 Electron 无边框窗口，`alwaysOnTop: false`、`skipTaskbar: true` | 开发降级与 UI/缩放调试 | 保留为明确 fallback；不是桌面宿主 |
| 通过进程外 Python `ctypes` 调用 Win32，将 Electron HWND 挂入 Explorer 的 `WorkerW`/`Progman` 层 | 在当前机器验证桌面露出、普通窗口覆盖与 Win+D 语义 | 作为 spike；必须 SetParent 后回读父类，失败即 fallback |
| 后续编译的最小原生 helper | 若 Python spike 成立，减少运行时依赖并加强打包/恢复 | 阶段 1 不实现 |
| 透明或磨砂窗口 | 视觉增强 | 延后；本阶段只验证不透明、连续可缩放窗口 |

`WorkerW`、`Progman`、`SHELLDLL_DefView` 的组合属于 Explorer 内部实现细节，不是稳定公共 API。当前验证通过也只代表已测 Windows 构建；后续必须保留失效检测、重新附着和普通窗口降级路径。

## 实际环境

采集日期：2026-09-15，应用时区：Asia/Shanghai。

| 项目 | 实测值 | 状态 |
| --- | --- | --- |
| 操作系统 | Microsoft Windows 11 专业版，10.0.22631，Build 22631，64 位 | PASS |
| 机器 | MECHREVO Jiaolong16K Series GM6BG0Q | PASS |
| Node.js | 22.13.1 | PASS |
| 系统 npm | 10.9.2；首次依赖树解析触发 npm Arborist `edgesOut` 空值异常 | FAIL |
| 项目锁定 npm | 11.19.1，通过 `npx --yes npm@11.19.1` 使用，不修改全局 npm | PASS |
| Electron | 44.3.0，`npx electron --version` 返回 `v44.3.0` | PASS |
| electron-vite | 5.0.0，Win32 x64 / Node 22.13.1 | PASS |
| TypeScript | 6.0.3 | PASS |
| Python bridge runtime | `D:\Anaconda\python.exe`，Python 3.10.9 | PASS |
| Ninja | 1.10.2 | PASS |
| `cmake` / `msbuild` / `cl` | 当前 PATH 不可用；本阶段 Python bridge 不依赖它们 | NOT_RUN |

依赖安装的真实命令：

- `npm install`：`FAIL`，npm 10.9.2 在 peer 树解析中抛出 `Cannot read properties of null (reading 'edgesOut')`。
- `npx --yes npm@11.19.1 install`：`PASS`，安装 115 个包，审计 0 个漏洞。
- `npx --yes npm@11.19.1 install-scripts approve --all`：`PASS`，固定批准 `@swc/core@1.16.2`、`esbuild@0.25.12`、`esbuild@0.28.2` 的构建脚本；随后 `install-scripts ls` 报告无未审查脚本。

## 原型边界与诊断

目标窗口参数：默认 `480 × 420 DIP`，最小 `320 × 240 DIP`，无边框、不透明、`resizable: true`、`transparent: false`、`alwaysOnTop: false`、`skipTaskbar: true`；先 `show: false`，内容就绪后使用非激活显示。renderer 保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。

原生桥接只能启动仓库内固定脚本，`shell: false`，只接受从 Electron `getNativeWindowHandle()` 解析出的十进制 HWND。当前 PATH 将 `python` 解析为 `D:\Anaconda\python.exe`；该外部运行时尚未纳入安装包。桥接不得注入 Explorer、不得要求管理员权限，也不得接受任意命令、脚本路径或 Shell 参数。成功标准是 helper 先成功设置 Per-Monitor V2 DPI awareness，再执行 `SetParent`，随后读取父 HWND、父窗口类、窗口 style/exStyle，并确认父类属于本 spike 允许的 `WorkerW`/`Progman`。

窗口状态写入测试或正式 `userData` 下的 `desktop-window-state.json`，移动/缩放采用 250 ms 防抖，写入使用临时文件后 rename；宿主健康检查周期是 10 秒，只有 Windows bridge 模式启用。恢复时按当前显示器工作区夹取；显示器增删或 bounds/workArea/scaleFactor 变化时重新检查并尝试恢复。当前 Electron 窗口与 Explorer 宿主可能具有不同 DPI awareness；跨进程 `SetParent` 的 DPI 行为是已知风险，不能从当前单屏 150% 结果外推。

当前真实 attached 诊断：Windows Build 22631，`scaleFactor=1.5` / `GetDpiForWindow=144`，route 为 `workerw-after-defview`，目标类 `Chrome_WidgetWin_1`，父类 `WorkerW`；attach 时 style `0x44070000`，显示后的独立 inspect 为 `0x54070000`，exStyle `0x200180`。独立 helper inspect 在 Electron 存活期间再次读取到相同父 HWND，故“原生父子关系成立”子项为 `PASS`；这不等于 Win+D、覆盖或任务切换行为通过。

## 自动与 GUI 验证结果

| 检查 | 方法与客观证据 | 状态 |
| --- | --- | --- |
| TypeScript 静态检查 | Lead 最终执行 `npm run check`，退出 0 | PASS |
| 平台测试 | QA 独立编写并执行；Lead 最终重跑 `npm run test:platform`，构建成功，4 项中 2 PASS、2 FAIL，进程退出 1 | FAIL |
| electron-vite 构建 | `npm run build` 退出 0；main、preload、renderer 均产出 | PASS |
| bridge 输入与安全边界 | 非法/零/不存在 HWND 均返回单条结构化 JSON 与非零退出码；固定 argv、`shell:false`、无注入 API | PASS |
| 原生宿主附着与回读 | 真实 Electron 状态为 `mode=desktop`、`attached=true`；独立 inspect 再次确认同一 WorkerW 父句柄 | PASS |
| desktop/fallback 区分 | 强制 fallback 状态为 `mode=fallback`、`attached=false`，窗口明确显示 `DEVELOPMENT FALLBACK` | PASS |
| 启动不抢焦点 | 多次最终状态均 `focused=false` 且使用 `showInactive()`；没有前景 HWND 高频采样，不能排除瞬时抢焦点 | NOT_RUN |
| 默认几何 | 150% DPI 下 fallback 为 480×423、desktop 为 482×424；状态文件也保存偏差，未达到精确 480×420 | FAIL |
| 连续拖动、非预设缩放 | 窗口级自动化对 CSS drag 和非客户区边缘 drag 未产生可判定动作，且不能把目标点拖出当前窗口；未获得人工证据 | NOT_RUN |
| drag/no-drag | fallback 实际 Electron 中点击交互按钮 3 次，计数从 0 精确变为 3；该子项不证明 desktop 模式可点击 | PASS |
| 位置尺寸重启恢复 | 已确认隔离状态文件写入；未完成 437×386 鼠标调整后的正常退出/重启，且默认高度当前错误 | NOT_RUN |
| 普通窗口覆盖 | 未执行真实 desktop 模式的连续覆盖证据；窗口自动化无法直接选择 reparent 后的 WorkerW 子窗口 | NOT_RUN |
| Win+D 后仍可见 | 当前自动化规范禁止发送 Windows 键；需要用户在本机按步骤人工确认 | NOT_RUN |
| 100%/150%/200% DPI 与跨显示器 | 当前仅能采集现有 scaleFactor；切换系统缩放或显示器配置未获授权 | NOT_RUN |
| Explorer 重启恢复 | 可能中断用户工作，本轮不自动执行 | NOT_RUN |
| 睡眠/唤醒恢复 | 会中断当前会话，本轮不自动执行 | NOT_RUN |

Windows 窗口自动化保存了 fallback 模式的实际截图到本任务的工具记录，显示默认壳层、明确降级标签、可见按钮和 `Interaction count: 3`；没有把截图写入源码目录。真实 desktop 子窗口在挂接后不会出现在该工具的可选顶层窗口列表中，因此不能用同一工具完成鼠标与覆盖验证。

阶段 1 结论：WorkerW 原生方案在当前 Build 上具备“可挂接且可独立回读”的可行性，但桌面行为验收仍不完整，且 150% DPI 下存在确定的外框尺寸/持久化偏差。当前产物只能称为开发 spike；桌面组件完成结论被阻塞，纯业务阶段可继续。

## 人工验证步骤

以下步骤只有实际执行并保存诊断/截图后才能改为 `PASS`：

1. 启动真实 desktop 模式，确认界面显示 `DESKTOP ATTACHED`，并保存同一时刻的父 HWND、父类和 route 诊断。
2. 打开普通应用并覆盖组件；组件不得置顶穿透普通应用。最小化或关闭普通应用后，组件应重新露出。
3. 按 Win+D；组件应仍在桌面层可见。再次按 Win+D 恢复普通窗口，普通窗口应重新覆盖组件。
4. 检查任务栏和 Alt+Tab；不得存在普通应用条目。仅检查 style 位不能替代此人工步骤。
5. 从拖动区连续移动窗口；从边缘连续调整到至少两个非预设尺寸；点击标记为 no-drag 的按钮，计数必须增加。
6. 退出并重新启动，确认位置与尺寸恢复；将窗口移到不同缩放的显示器后重复。断开该显示器再启动，窗口必须夹取到现有工作区。
7. 仅在可中断的授权测试环境中重启 Explorer，观察宿主失效检测、重新附着或明确 fallback；同理验证睡眠/唤醒。

## 参考

- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Custom Window Styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
- [Microsoft SetParent](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [Microsoft Extended Window Styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/extended-window-styles)
- [Microsoft High DPI reference](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-reference)
