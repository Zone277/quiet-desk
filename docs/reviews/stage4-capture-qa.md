# 阶段 4 Quick Capture 独立 QA

日期：2026-09-23

生产代码基线：`main@1a9e266d2889f4e47c422a99cc3cc1c38687a04d`

QA 自动化门槛：`PASS`。QA 结束时真实 Windows IME 与系统快捷键检查为 `NOT_RUN`；Lead 后续补测 IME，见文末补充。

QA agent 新增 `tests/e2e/stage4-capture.mjs` 与本报告，并实际修改 `tests/e2e/stage3-harness.mjs` 以支持受限的 `extraEnv`；agent 最初将该 harness 改动误报为既存改动，Lead 复核 Git diff 后在本报告纠正。Lead 随后在主进程增加仅限隔离测试 userData 的一次性提交故障注入，并把 Stage 4 加入正式 `test:e2e` 脚本。测试沿用 `%TEMP%` 隔离 userData，并在每次运行后验证删除。

## 环境与命令

| 状态 | 项目 | 实际结果 |
| --- | --- | --- |
| `PASS` | Windows | Microsoft Windows 11 专业版 64 位，10.0.22631（Build 22631） |
| `PASS` | 命令行运行时 | PowerShell 7.6.5；系统 Node v22.13.1；npm 10.9.2 |
| `PASS` | Electron E2E 运行时 | Electron 44.4.3；内嵌 Node 24.21.0；SQLite 3.53.4；Playwright 1.63.0 |
| `PASS` | Markdown 依赖 | react-markdown 10.1.0；remark-gfm 4.0.1 |
| `PASS` | `npm run build` | exit code 0；main 19 modules、preload 3 modules、renderer 291 modules 构建完成 |
| `PASS` | `node tests/e2e/stage4-capture.mjs`（QA agent 门槛） | QA 收敛后的脚本连续两次 exit code 0，耗时 9.3 秒与 9.2 秒；均输出 `STAGE4_CAPTURE_PASS` |
| `PASS` | 最终一次隔离清理 | `quietdesk-stage4-capture-4NWgvS` 与 `quietdesk-stage4-shortcut-rtxPS9` 均输出 `removed:true` |
| `PASS` | 最终一次进程证据 | Capture 流程 PID 24484、32136、8376；快捷键流程 PID 21256、29708；三次 Capture PID 证明草稿恢复与提交后持久化使用了真实 Electron 重启 |
| `FAIL` | 过程性 E2E：瞬时 `saving` 状态观察 | exit code 1；同步 SQLite busy wait 遮蔽自动化通道中的瞬时 UI 状态。QA 改为由 renderer 定时制造在途新编辑，并以释放锁后的 revision 与正文落盘为判据 |
| `FAIL` | 过程性 E2E：持续写锁提交失败模拟稳定性复跑 | exit code 1；同一模拟先前可 PASS，复跑出现“失败提示已出现但 BrowserWindow 已隐藏”的相反状态，因此该模拟不作为最终 PASS 证据 |
| `PASS` | Lead 确定性提交故障重试 | 仅当 `QUIETDESK_TEST_USER_DATA` 已设置时，一次性返回可重试 `STORAGE_ERROR`；E2E 断言窗口仍可见、输入与草稿正文仍在、无 Note/事件，随后复用提交尝试并只创建 1 条 Note |
| `PASS` | Lead `npm run check` | exit code 0；TypeScript 与 9/9 公共契约测试通过 |
| `PASS` | Lead `node --check tests/e2e/stage4-capture.mjs` | exit code 0 |
| `PASS` | Lead 最终 Stage 4 E2E | 重新构建后运行一次、再独立复跑一次，均 exit code 0；耗时 12.6 秒（含 build）与 9.7 秒；两个运行均清理 2 个隔离 userData 目录 |
| `PASS` | Node SQLite 警告处理 | 每次运行均出现 Node 22 `ExperimentalWarning`；未抑制警告，Electron 内实际 SQLite 版本已记录 |

同一 E2E 在开发过程中共实际运行 7 次：5 次 exit code 0、2 次 exit code 1；最后收敛后的默认脚本连续 2 次 exit code 0。

## 自动化覆盖

| 状态 | 场景 | 实际断言 |
| --- | --- | --- |
| `PASS` | v3/阶段 4 启动 | Capture bootstrap 返回 `contractVersion=3`、`stage=4` |
| `PASS` | 默认 Note 与中英多行输入 | 默认选中 Note；中文、英文、标点、emoji 可输入；Enter 产生正文换行 |
| `PASS` | composition 自动逻辑 | DOM `compositionstart` 到 `compositionend` 期间发送带 `isComposing=true` 的 Ctrl+Enter，未创建 Note、未隐藏 Capture |
| `PASS` | 草稿乱序保护 | SQLite 短时写锁下第一快照在途时由 renderer 产生更新；释放后服务端 revision 增长且最终只落盘最新正文 |
| `PASS` | blur | Library 获得焦点后 Capture 未提交、未隐藏、标题与正文未清空，草稿 revision 不变 |
| `PASS` | Esc 保存与 Widget 重开 | 在自动保存计时前加入最新一行并立即 Esc；窗口隐藏，草稿 revision 增长、最新正文落盘；Widget 入口重开后完整恢复 |
| `PASS` | 草稿跨重启恢复 | 第 2 个 Electron PID 使用同一隔离 userData，恢复相同草稿 revision、标题和 Markdown 正文 |
| `PASS` | Ctrl+Enter 与快速重复 | 连续派发两次 Ctrl+Enter 后只产生 1 条 Note、1 个同时含 `notes`/`drafts` 的 change event，Capture 成功后隐藏 |
| `PASS` | 确定性故障与重试 | 首次提交收到模拟的可重试存储错误后 Capture 保持可见，标题、正文和持久草稿不变，没有 Note 或 `notes` 事件；再次快速提交成功且不重复 |
| `PASS` | Widget/Library 更新 | Widget 与 Library 收到同一 eventId；Widget 仅显示纯文本摘要，Library 当日列表恰有 1 条并能打开完整 Markdown |
| `PASS` | 创建后重启与草稿清除 | 第 3 个 Electron PID 重启后 Widget/Library 仍各有唯一 Note；正文一致；`drafts.get` 为 null，Capture 标题与正文为空 |
| `PASS` | GFM 预览 | 表格、代码块、引用、删除线和文档清单正常进入预览；Widget 不渲染完整 table/pre/MarkdownView |
| `PASS` | raw HTML | `<script>` 和探针 `<div>` 均未进入 DOM，脚本全局探针未执行 |
| `PASS` | 远程图片 | 预览无 `<img>`，出现“远程图片已阻止”占位；Playwright 网络监听未观察到测试远程图片请求；Library 阅读视图同样无 `<img>` |
| `PASS` | 危险链接 | Markdown 中 `javascript:` href 被清空且点击不导航；IPC 拒绝 `javascript:`、`data:`、`file:` 和相对 URL，均返回 `INVALID_REQUEST`；Widget 调用外链接口返回 `FORBIDDEN` |
| `PASS` | 安全 HTTPS 链接 | 点击不导航 renderer；Capture IPC 接受并规范化绝对 HTTPS URL。测试环境禁用了真实系统浏览器打开 |
| `PASS` | 快捷键冲突可见 | 注入默认 `Ctrl+Shift+Space` 冲突后，Widget 与 Library 均显示冲突，bootstrap 返回 `registered:false`、`failure:'conflict'` |
| `PASS` | Widget 回退入口 | 快捷键冲突时 Widget 捕获按钮保持可见并可打开 Capture；改为 `Ctrl+Alt+F11` 后注册成功，冲突提示消失且重启后配置仍存在 |

## 未测项与限制

| 状态 | 项目 | 原因/边界 |
| --- | --- | --- |
| `NOT_RUN` | 真实中文 IME 候选确认 | 仅验证了 DOM composition 自动逻辑；没有使用真实 Windows 中文输入法人工选择候选词，不能替代 IME 验收 |
| `NOT_RUN` | SQLite 持续写锁下 UI 提交失败、释放后重试 | 重复 GUI 模拟结果不稳定，已从默认门槛移除；确定性故障注入覆盖 UI 状态机，Data 局部测试覆盖事务回滚，但两者不冒充持续 SQLite 锁的端到端证据 |
| `NOT_RUN` | 真实 OS 全局快捷键按键唤起 | 自动化验证了注册/冲突状态、持久化和 Widget 回退入口，但未向 Windows 发送系统级快捷键 |
| `NOT_RUN` | 真实外部浏览器打开 | 使用 `QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN=1` 避免测试产生外部副作用；只验证 renderer 不导航与主进程 URL 策略 |
| `NOT_RUN` | 截图和人工视觉检查 | 本轮证据为 Electron/Playwright 断言及 stdout；未生成或人工审查截图 |
| `NOT_RUN` | 打包产物 | 仅测试 `electron-vite build` 后的开发构建入口，未运行 portable/dist 产物 |
| `NOT_RUN` | 仅 checkout 干净 `1a9e266` 且不含现有 harness `extraEnv` 改动 | 当前共享工作区已有 Lead/用户的 harness 改动；本轮未覆盖或回滚该文件 |

`BLOCKED`：无。最终默认 E2E 的核心场景均已执行；上表 `NOT_RUN` 项不冒充自动化证据。

## 交付文件与接口

| 状态 | 项目 | 结果 |
| --- | --- | --- |
| `PASS` | `tests/e2e/stage4-capture.mjs` | 新增独立 Electron Stage 4 E2E，复用隔离 userData harness |
| `PASS` | `docs/reviews/stage4-capture-qa.md` | 记录命令、exit code、版本、过程性失败、最终证据和未测项 |
| `PASS` | `tests/e2e/stage3-harness.mjs` | 增加 `extraEnv`，固定测试 userData/fallback/show 参数仍在其后覆盖，不能由调用方改写 |
| `PASS` | 接口变化 | 无公共契约或 preload 表面变化；新增一次性故障注入只在隔离测试 userData 且显式环境变量存在时启用 |

## Lead 后续补测（2026-09-23）

- `PASS`：真实 Windows Build 22631、Electron 44.4.3 Capture 中，通过原生窗口输入逐键输入拼音，截图实际出现系统中文候选栏；空格确认后正文出现汉字。候选栏在场时按 Ctrl+Enter，Capture 未提交、隐藏或清空，之后仍可确认汉字。工具截图和可访问性树见本任务记录。这是实际系统 IME 操作，与 DOM 合成事件分开。
- `PASS`：扩充 Stage 4 E2E，通过 Capture UI 显式创建 Task、跨午夜定时日程和多日全天日程，并在 Widget/Library 验证；Markdown 清单和自然语言日期未派生独立实体。扩充后 `node tests/e2e/stage4-capture.mjs` 退出 0，两个隔离 userData 均 `removed:true`。
- `NOT_RUN`：原生 IME 检查没有运行完整视觉矩阵或系统级快捷键。该次单独 IME 测试的临时目录清理命令被执行策略拒绝，目录是否仍存在未再次确认；正式 userData 未访问。
