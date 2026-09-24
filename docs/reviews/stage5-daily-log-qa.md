# Stage 5 Daily Log QA（2026-09-24）

## 范围与分工

QA 独立修改 `tests/e2e/stage3-harness.mjs`、`stage3-business.mjs`、`stage3-visual.mjs`、`stage4-capture.mjs`，新增 `tests/e2e/stage5-daily-log.mjs` 和本文。公共契约、preload、主进程、Data、UI、`package.json` 由 Lead/Data/UI 维护；QA 未修改这些文件，也未执行 Git 提交。Lead 将 Stage 5 脚本接入 `test:e2e`。

## 真实执行结果

| 命令 | 状态 | 结果 |
| --- | --- | --- |
| `node --check tests/e2e/stage5-daily-log.mjs` 等四个 E2E 脚本 | PASS | 退出 0 |
| `npm run build` | PASS | 退出 0，main、preload、三 renderer 入口构建完成 |
| `node tests/e2e/stage5-daily-log.mjs` 首次 | FAIL | 退出 1；测试夹具令牌的下划线被 Markdown 转义，断言误用原始连续字符串；改为无需转义的令牌，未改产品断言 |
| `node tests/e2e/stage5-daily-log.mjs` 两次后续运行 | PASS | 退出 0；真实 Electron/preload/SQLite，第二次包含跳日、零点边界和物理表关联检查 |
| `npm run test:e2e` | PASS | 退出 0；`E2E_WINDOWS_SECURITY_PASS`、`STAGE3_BUSINESS_PASS`、`STAGE4_CAPTURE_PASS`、`STAGE5_DAILY_LOG_PASS` 均输出 |
| 最终 `node tests/e2e/stage5-daily-log.mjs` | PASS | 退出 0；Electron 44.4.3 / Node 24.21.0 / SQLite 3.53.4 / win32 |
| `git diff --check -- tests/e2e` | PASS | 退出 0；仅本机 LF/CRLF 提示 |

整套 E2E 的 Stage 5 运行使用四个独立 Electron PID（31328、26996、22432、22180），固定 `Asia/Shanghai` 与 2026-09-21/22/23，SQLite 3.53.4。主测试临时 userData 为 `%TEMP%/quietdesk-stage5-daily-log-gklZW7`；独立跳日和零点边界测试各用另一临时目录。脚本在 `finally` 中按前缀校验后清理。整套运行和最终单独复跑的主临时目录经 `Test-Path -LiteralPath` 检查均不存在。测试导出文件只写入主测试临时目录。

## 验收覆盖

- A17/A18/A20：A 日创建/计划而未完成；B 日完成；C 日改标题、改计划日、重新打开后，A/B 结构化日志完整不变。同日完成再重开只列为待办，但历史保留完成与重开。重复读取与跨 Electron 进程重启时日志内容、ID 和时间戳相等；手写区 revision、幂等回放及冲突均有断言。
- A19：A 日关闭应用、跳过 B 日、C 日启动并首次查看 B 日；B 日日志仅一份。第二进程测试系统时区设为 UTC，持久化应用时区仍为上海。另在上海 23:59:59.999 和次日 00:00:00.000 操作，核对历史归属日和两日日志。
- A09/A10：任务、笔记、日程三类实体在回收站时从 A/B/C 自动区隐藏，恢复后按原历史重建；错误确认 ID 被拒绝。永久删除后重新生成仍隐藏，关闭进程后检查 SQLite 实体行、操作快照、自动条目及含正文回执。
- A26：导出前/软删除后/永久删除后读取实际 UTF-8 Markdown 文件；新导出不含隐藏实体自动内容，中文、代码块与含相同关键词的独立手写区保留。删除不改写先前已导出的独立文件。
- 安全与取消：Widget/Capture 调用三个 Daily Log 方法均返回 `FORBIDDEN`；renderer 附带目标路径返回 `INVALID_REQUEST`。取消导出返回 `cancelled` 且目标文件不存在。

## 导出测试边界

导出与取消通过 Playwright Electron 主进程 `evaluate`，在**测试进程内**将 `dialog.showSaveDialog` 的结果限定为临时目录文件或取消；仍经过真实 preload、IPC、主进程最新日志读取和 UTF-8 写入。renderer 没有路径或正文写入能力。真实 Windows 原生保存对话框的鼠标/键盘交互为 `NOT_RUN`；此测试不证明该 GUI 操作。Windows 桌面驻留/Win+D 等阶段 1 人工验收亦非本项证据。
