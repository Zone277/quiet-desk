# QuietDesk

Windows 本地待办、日程、Markdown 笔记与 Daily Log 原型。当前交付状态：**开发预览，桌面验收未完成**。不提供云端、账号、AI、提醒、重复日程或外部日历。

## Windows 启动与构建

当前验证目标为 Windows 11 x64 Build 22631；未测试的 Windows、DPI 和多显示器组合不宣称支持。

1. 发布产物为 `release/QuietDesk 0.1.0.exe`（portable，无安装向导），也可运行 `release/win-unpacked/QuietDesk.exe`。把 portable 放在固定、可写的本地目录后启动；不要在临时下载目录启用登录启动。未签名的原型不提供绕过 Windows 安全提示的操作说明。
2. 开发环境需要 Node.js ≥22.12、npm 与 Windows .NET Framework C# 编译器（native helper 构建），执行 `npm ci`、`npm run dev`。开发服务仅用于开发；发布程序使用打包静态资源，不依赖服务器。
3. 验证：`npm run check`、`npm run test:integration`、`npm run test:e2e`、`npm run build`、`npm run dist:win`。详细命令、退出状态与环境见 [发布清单](docs/RELEASE-CHECKLIST.md)。依赖已锁定，不需要全局安装或升级 npm。

## 窗口与托盘

- 托盘：显示/隐藏 Widget、打开 Library、设置、退出。设置入口打开 Library，语言/主题在窗口顶栏，快捷键在 Library 上方；托盘设置子菜单另提供默认关闭的登录启动开关。只有用户明确点击该开关才会改 Windows 登录配置；开发和隔离测试中禁用。
- 关闭窗口是隐藏，不等于退出；用托盘“退出 QuietDesk”结束应用、注销快捷键、保存窗口状态并关闭数据库。Widget 显示不主动聚焦；捕获入口或 `Ctrl+Shift+Space` 明确唤起 Capture 后聚焦正文。
- Capture 默认笔记，可显式切换任务/日程。Enter 换行，Ctrl+Enter 成功保存后收起，Esc 保存草稿并收起；失败保留输入。未保存的最后输入不是断电零损失承诺。
- 桌面宿主通过 `DesktopHostAdapter` 与 Win32 helper 挂接 Shell 窗口。WorkerW/Progman 的结构不是稳定公开 API，失败会明确标识为开发降级；普通非置顶窗口不算桌面完成。透明/磨砂未启用，当前使用不透明可缩放窗口。

## 本地数据与副本

- 正式 SQLite：Electron 正式 `userData` 下 `data/quietdesk.sqlite3`；默认 `%APPDATA%/quiet-desk/data/quietdesk.sqlite3`，以发布诊断记录的 `app.getPath('userData')` 为准。
- 开发：`%APPDATA%/QuietDesk-preview/`；显式 demo：`%APPDATA%/QuietDesk-demo/`。普通启动不插入演示数据。
- 测试：harness 启动前指定独立临时目录；阶段 6 发布证据使用 `test-results/stage6/发布 验证/隔离 数据 …/`。不要让测试指向正式目录。
- 完成历史长期保留；删除先进入回收站。恢复按旧快照重建日志，永久删除需明确确认，并逻辑清理应用管理的正文、操作快照与自动日志，不承诺取证级物理擦除。
- 手写补充独立持久化，不因含相同关键词而被删除。已经导出的 Markdown 和外部备份属于独立副本，后续删除不会自动修改它们。不要在数据库打开时直接复制数据库文件作为可靠备份。

## 已知限制

- Win+D、真实桌面覆盖/返回、任务栏/Alt+Tab、Explorer 重启/睡眠和未测 DPI/显示器组合必须按发布清单分别验收，不能用 Playwright 或网页预览代替。
- `node:sqlite` 是 Electron 内置原生 SQLite（不是 better-sqlite3），会打印实验性警告；每次 Electron 升级必须重新验证发布库迁移、读写和重启。
- 当前 150% 单屏实测外框默认 480×420 DIP，内容区 478×420；鼠标连续缩放、100%/200% 和多屏仍未完整验收。当前版本真实中文候选确认与原生保存对话框已实测，其他输入法/版本不据此宣称支持。
- 性能是固定配置下的实测记录，不宣称“小于某个 MB”或“原生级”。完整结果、未验证项和交付边界见 [进度](docs/PROGRESS.md) 与 [验收矩阵](docs/ACCEPTANCE.md)。
