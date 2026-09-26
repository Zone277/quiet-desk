# 阶段 6 发布验证清单

结果状态使用 PASS / FAIL / BLOCKED / NOT_RUN，并另列自动/原生人工类型。本原型当前仍是“开发预览，桌面验收未完成”。

## 自动命令

由 Lead 串行执行 `node scripts/stage6-verify.mjs`，逐项真实调用已实现脚本，不输出空成功。完整日志保存在 ignored `test-results/stage6/commands/`，包含时间、环境和退出状态。

| 命令 | 类型 | 状态 | 证据 |
| --- | --- | --- | --- |
| npm run check | 自动 | PASS | 退出 0；11 契约测试、tsc；commands/check.log |
| npm run test:integration | 自动 | PASS | 退出 0；实际 Electron SQLite；commands/test-integration.log |
| npm run test:e2e | 自动 | PASS | 退出 0；阶段 2–6 安全/业务/捕获/日志/生命周期；commands/test-e2e.log |
| npm run build | 自动 | PASS | 退出 0；commands/build.log |
| npm run dist:win | 自动 | PASS | 退出 0；commands/dist-win.log；portable 101,356,478 字节 |
| node scripts/stage6-release-smoke.mjs | 自动 | PASS | 退出 0；发布 SQLite/重启/v3→v4/中文空格路径/应用网络拒绝；发布 验证/report.json |
| node scripts/stage6-portable-smoke.mjs | 自动 | PASS | 退出 0；真实自解压启动器＋loopback CDP；两次进程启动、笔记恢复、内置 helper；便携 启动/report.json |
| npm run test:release -- "…/应用 含空格/QuietDesk.exe" | 自动 | PASS | 退出 0；19 个 IPC 拒绝情境；commands/release-ipc.log |
| npx vitest run tests/data tests/platform | 自动 | PASS | 退出 0；69/69；commands/data-platform.log |
| npx vitest run --config src/renderer/vitest.config.ts | 自动 | PASS | 退出 0；4/4；commands/renderer.log |
| node --test tests/platform/stage6-release-audit.test.mjs | 自动 | PASS | 退出 0；4/4；静态审查，非运行时安全替代 |

## 原生系统检查

| 检查 | 类型 | 状态 | 方法与边界 |
| --- | --- | --- | --- |
| Win+D 后可见，普通窗口覆盖且不置顶 | 原生人工 | NOT_RUN | computer-use 技能禁止发送 Windows 键组合；用户手动 Win+D，再打开普通应用覆盖 Widget 并返回桌面，观察实况 |
| 真实中文 IME 候选确认 | 原生交互 | PASS | agent 用原生 SendInput，在当前系统真实候选栏选“你”；候选中 Ctrl+Enter 不提交，Return 确认保留，多行中英文随后 Ctrl+Enter 成功收起；见下方证据。不是 DOM 模拟，不承诺所有 IME |
| 托盘鼠标入口、关闭隐藏、退出 | 原生人工 | NOT_RUN | 自动模板/生命周期测试不代替托盘点击 |
| 原生保存对话框 / 中文 Markdown | 原生交互 | PASS | agent 点击 Library 导出，在真实 Windows 保存对话框指定中文空格文件名；界面“导出已保存”，UTF-8 文件 218 字节含完整中文/英文/换行；没有替换 dialog 返回值 |
| Explorer 重启、睡眠/唤醒 | 原生人工 | NOT_RUN | 仅授权测试环境；保存工作后重启 Explorer/睡眠，确认恢复日志、重试与退出，无授权不执行 |
| 100%/150%/200% 与多屏/移除屏幕 | 原生人工 | NOT_RUN | 只报告实测组合；不擅自修改用户系统 DPI |
| 整机断网运行 portable | 原生人工 | NOT_RUN | 不擅自断开用户网络；应用网络被拒绝的自动测试单列，不能冒充整机断网 |
| 登录启动系统配置 | 原生人工 | NOT_RUN | 默认关闭，只有明确点击才修改；验证时需在授权测试账户打开后关回，当前不改用户配置 |

## 交付审查

- 发布 renderer 使用本地 file 资源，无开发服务器/云端依赖；检查 helper 与内置 SQLite，记录路径和迁移版本。
- 正式/开发/测试目录分离；普通空库启动无 demo，发布故障注入/固定测试时钟禁用。
- 关闭与退出不同；退出等待保存、解绑、注销快捷键、关闭数据库；检查后台轮询/动画/监听清理。
- 性能记录完整进程采样、配置和方法；短命 helper 的采样盲区、共享页求和和 CPU 口径明确，不作峰值保证。
- 删除不影响独立导出/备份；手写区不按关键词删除；README 明示边界。
- 只随 Git 提交源代码与文档，数据库/截图/日志/发布二进制不提交。各功能增量推送远端。

## 环境、证据与失败记录

最终五项命令在 2026-09-26 13:26:07–13:29:29（Asia/Shanghai）执行，Windows 11 Pro x64 Build 22631、Node 22.13.1、npm 10.9.2；发布 Electron 44.4.3 / Node 24.21.0 / 内置 SQLite 3.53.4。未升级全局 npm。仅一屏 150%，1707×1067 DIP（工作区 1707×1019）。签名检查为 NotSigned；builder 使用默认应用图标并报告缺 author/重复依赖引用警告，构建退出仍为 0，未绕过安全提示。

所有路径以下相对 workspace 的 `test-results/stage6/`，目录 ignored，原始数据库和截图不会进入 Git。命令记录 `commands/results.json` 包含逐项时间/环境/退出码；首轮 E2E FAIL 保留于 `commands-first-run/`。未登记 probe 原来依赖 `getLastWebPreferences().preload`，实际无法取得 preload；Lead 改为真实产物 preload 路径，并用相同 file URL 的未登记 sandbox 窗口重新证明 FORBIDDEN。退出检查提前保存 ChildProcess 引用，不在 Playwright dispatcher 销毁后查询；没有弱化安全断言。

首次 portable `_electron.launch` 调试握手超时（退出 1），实际窗口出现，但不记 PASS；最终改为正常启动 portable、只在隔离测试加 loopback renderer CDP 与 20 秒自动退出，两轮成功。正式启动不带调试参数。首轮原生交互收尾因隐藏 Capture 截图超时退出 1，业务观察不因此改写为失败或脚本成功；后来只截可见窗口，复用同一隔离库重启验证正文，命令退出 0，原 `evidence.json` 保留，新增 `evidence-restart.json`。

原生交互证据：`原生 交互 1790400950483/evidence.json` 记录真实 compositionstart/end、Process/isComposing 和非组合 Enter；`中文 导出.md`、`evidence-restart.json`、三个 `*-final.png`。本轮 Codex 原生窗口截图实际显示中文候选、编辑框、保存对话框和保存成功；这些瞬态原生截图在任务工具记录中，不伪称已存候选栏 PNG。当前输入法供应商/版本未核对；其他输入法 NOT_RUN。

视觉：UI owner 实际检查 96 张基线（87 PASS、9 FAIL），修复后实际检查定向 36 张全部可见视口 PASS；目录和逐图判定见 `src/renderer/stage6-visual-review.md`。Lead 另实际打开最终发布三个截图和两个修复样本；Capture/Library 可滚动，不能把屏外内容算已看。system 本机解析 light，真实 OS 外观切换 NOT_RUN。Capture/Library 降低最小窗口限制只用于测试压力，不改变生产最小尺寸。

产物：`release/QuietDesk 0.1.0.exe` SHA-256 `6C6565AE77C22C2DEA77D5B18B1E4B65EFBEC944ABD785337C99C8C39242F141`。`release/win-unpacked/` 中有 `resources/app.asar` 与 `resources/native/windows_desktop_host.exe`；发布运行从源码之外 cwd 启动且显式不可达 ELECTRON_RENDERER_URL 被忽略，所有三窗口 file URL。测试只用独立 userData，空库普通初始化没有 demo。没有运行 dev server，也没有断开用户整机网络；应用网络拒绝不等于整机断网 PASS。

## 发布版性能与资源清理

`发布 验证/report.json`：AMD Ryzen 7 7735H、16 logical CPU、可见物理内存 15.24 GiB。三个窗口显式显示、空库加一条笔记/日志；等待 5 秒后取 6 次约 1 秒采样。两次三窗口就绪为 **1597 ms / 1326 ms**（含 Playwright 握手，不是冷启动统计分位数）。Electron 6 进程工作集合计 **642.20–650.17 MiB**，`app.getAppMetrics` CPU 求和 **0.0097%–0.0692%**（Electron 自身口径）。额外 OS Get-Process 6 进程求和 **642.21–650.17 MiB**，累计 CPU 差分 **0–0.589%**（100%=一个逻辑核）。不把分辨率误写成 MB，也不宣称零 CPU 或低于任意门槛。

工作集含共享页重复计数；helper 为短命进程，采样间可能错过，故不能保证真实峰值/全时总量。OS JSON 输出明确 UTF-8，保留首次编码未设时的 report-first.json，不引用乱码路径。输入/大量条目的性能、长时间 soak、冷启动及隐藏窗口默认场景性能为 NOT_RUN。

静态审查：宿主健康检查每 10 秒一次、不会重入；退出清 interval/保存 debounce，移除显示器、resume、窗口监听并等待在途操作。动画仅 loading/completion spinner，闲置截图没有活动 spinner；不是全天 FPS 测量。生命周期自动测试真实取消监听每窗口 100 次、上下文 100 次、10 次唤起/3 次 reload，没有重复投递；退出 SQLite 可完整重开/integrity=ok。长期监听、连接、资源泄漏检测仍 NOT_RUN，不将短回归提升为长期无泄漏承诺。
