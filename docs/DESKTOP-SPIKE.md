# 桌面宿主验证：阶段 6 当前结果

2026-09-26，Windows 11 Pro x64 Build 22631。本文记录当前代码与实测，不补造缺失的早期截图。结论仍为 **开发预览，桌面验收未完成**。

## 方案与边界

- 普通非置顶＋skipTaskbar：只允许标识为开发降级，不是桌面宿主。
- 历史 Python/ctypes 桥接：开发原方案，本次不再作为运行依赖、不打包 Python。
- 当前采用固定 x64 .NET Framework 4.x helper，通过 User32 P/Invoke 查找 WorkerW/Progman 并 SetParent。没有 Explorer 注入、云端服务、管理员常驻或全局环境安装。
- WorkerW 顺序、DefView、Progman 消息 0x052C 均属 Shell 内部行为，不是稳定公共 API；失败必须显示 fallback，不能隐瞒。
- 首先验证不透明窗口；transparent=false、resizable=true。磨砂/透明 NOT_RUN，不承诺两者稳定组合。

构建：`npm run build:native` 使用当前系统 Framework64/v4.0.30319/csc.exe；开发路径 `native/bin/windows_desktop_host.exe`，发布只用 `process.resourcesPath/native/windows_desktop_host.exe`，不搜索 cwd/PATH/Python。实际依赖、动作参数、styles、DPI、回滚及恢复流程见 [native/README.md](../native/README.md)。

attach 验证目标 HWND 与所有者 PID，保存 original styles/parent，设置 CHILD/TOOLWINDOW、清除 POPUP/CAPTION/APPWINDOW、保留 THICKFRAME；坐标按父窗口映射。resize 补偿限定 ±64 physical px；helper Per-Monitor-V2 awareness，不修改用户系统缩放。退出先等待在途健康检查/重试与保存，再 detach 回原父/样式。主程序将屏幕变化和 resume 纳入恢复，10 秒健康检查不重入。这里描述的是实现与局部测试，非 Explorer 重启/睡眠实测 PASS。

## 实际执行与证据

| 检查 | 状态 | 证据/范围 |
| --- | --- | --- |
| C# helper / Electron 构建 | PASS | npm build:native / build 退出 0；发布 helper 无外部 Python 依赖 |
| Win32 attach 与独立 inspect | PASS | Desktop agent `test-results/desktop-stage6/2026-09-26T05-14-11-998Z/desktop.json`；WorkerW 父、desktop 状态 |
| 150% 单屏默认几何 | PASS | 外框 480×420 DIP；content 478×420 DIP，未伪称内容也是 480 宽；修复历史外框偏差 |
| 非预设尺寸恢复 | PASS | Desktop owner 两个实际进程的 437×386 DIP 恢复证据；局部平台与生命周期测试，非鼠标连续拖拽证据 |
| 发布目录中文/空格＋helper | PASS | `test-results/stage6/发布 验证/report.json`，desktop/attached=true，bridge=win32-helper；实际发布截图已看 |
| portable 自解压后 helper | PASS | `test-results/stage6/便携 启动/report.json`，两轮实际启动，当前 WorkerW 挂接；不依赖源目录 |
| Win+D、普通窗口覆盖/返回桌面 | NOT_RUN | 原生操作工具的 computer-use 技能禁止 Windows 键组合；不绕过。真实桌面场景仍需用户人工验证 |
| 任务栏/Alt+Tab、无人操作不抢焦点 | NOT_RUN | styles/showInactive 是实现证据，不算真实场景验收 |
| 鼠标连续拖动/缩放与命中 | NOT_RUN | setBounds 与截图测试不能代替鼠标边缘拖动；交互区 CSS no-drag 仍需实测 |
| 多屏、屏幕移除、100%/200% | NOT_RUN | 仅150%单屏被测试，不修改用户配置 |
| Explorer 重启、睡眠/唤醒 | NOT_RUN | 无授权的隔离系统测试环境，不打断用户工作 |

人工步骤：运行隔离发布副本，记录 Build、scaleFactor、模式/父 HWND、外框与内容边界；按 Win+D 观察 Widget、打开普通应用覆盖后返回桌面；检查任务栏/Alt+Tab及被动数据更新焦点；用鼠标边缘连续改到非预设尺寸并拖动，完成按钮/捕获入口不得被拖动区域吞掉，退出重启读回。多屏/DPI或 Explorer/睡眠测试只在保存工作并明确授权的测试环境执行，观察恢复/失败提示和重试。未执行时保持 NOT_RUN。

桌面门槛 **BLOCKED**（缺完整真实场景验收证据）；这不否定已经通过的业务/打包子项，也不允许宣布最终桌面小组件完成。
