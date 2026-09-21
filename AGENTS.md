# QuietDesk：协作与交付规则

## 开始工作前
阅读 `docs/PRODUCT.md`、`docs/ACCEPTANCE.md` 和存在时的 `docs/PROGRESS.md`、`docs/CONTRACTS.md`。先检查当前代码、Git 状态、运行环境和已完成事项，不重做已经验证的工作。发生需求矛盾时保留用户最新明确要求，不擅自缩减需求。

## 交付原则
- 当前目标是 Windows 本地可运行原型，不是网页展示，不是生产级全平台发布。
- 每轮只完成当前提示词指定的阶段；有权限且无阻塞时直接实施、测试和修复，不停留在计划，不自动扩展范围。
- 非关键未定细节采用最简单的可逆实现并记录理由。安装、权限、不可逆数据操作等真正阻塞不得绕过。
- 不假装使用子 agent，不假装运行 Windows GUI 或人工测试。没有能力就准确标注。
- 未通过的测试不得通过删除测试、降低断言、关闭安全措施或改成 mock 来“修复”。

## 多 agent 协作
主 agent 是 Lead / Integrator，负责拆任务、公共契约、集成、复核和最终状态。最多同时运行 3 个子 agent；无并行收益时使用单 agent。

默认写入范围：
- Desktop：`src/main/windows/`、`src/main/platform/`、`native/` 及其局部测试。
- Data：`src/domain/`、`src/main/data/`、`src/main/services/`、`tests/data/`。
- UI：`src/renderer/` 及组件局部测试。
- QA：`tests/e2e/`、`tests/platform/`、`docs/reviews/`；独立审查时不直接修改生产代码。
- Lead：根目录构建配置、`package.json`、锁文件、`src/shared/`、`src/preload/`、`src/main/ipc/`、主入口和全局进度文档。

以上目录如因工具链调整，应由 Lead 在派发前更新所有权，保证不重叠。每个任务必须包含输入、输出、允许修改路径、禁止修改路径、验收条件及依赖。

先统一公共类型与 IPC 契约，再让 Data 和 UI 并行实现。修改契约必须先报告 Lead，由 Lead 更新契约和相关测试；禁止两边各自临时发明接口或使用 `any` 掩盖冲突。

共享工作目录不代表文件隔离。使用共享目录时只允许各 agent 修改各自范围，只有 Lead 执行 Git 切换、合并和提交。多个独立会话进行大量代码修改时优先采用独立 Git worktree；由 Lead 统一集成，禁止共享测试数据库或对同一二进制依赖并行重建。

子 agent 返回：任务标识、修改文件、接口变化、真实执行的检查与结果、未验证项、需 Lead 决策的事项。不要用长篇角色讨论替代结果。

## 工程边界
- npm 单仓库；依赖版本由当前官方文档和实际兼容性验证确定，并提交一个锁文件。
- 纯业务规则与时间查询可独立测试；系统窗口行为封装在 DesktopHostAdapter 后面。
- 数据库仅由主进程侧数据层访问，renderer 只访问类型明确的 preload API。
- `contextIsolation: true`、`nodeIntegration: false`、renderer sandbox 和最小 CSP；不暴露任意 IPC、SQL、文件路径写入或 shell 命令接口。
- Markdown 不执行原始 HTML，不默认请求远程图片；外链由主进程验证协议及目标后处理。
- 用户数据、草稿、测试数据库、日志和截图不得混入源码提交；测试使用独立目录。
- 不引入云同步、账号、AI、自然语言时间解析、复杂块编辑器、重复日程、通知系统或大型状态管理框架。
- 不打包 Apple 字体、图标或品牌素材；通过系统字体、布局、配色和层级建立原创视觉。

## 运行与测试
阶段 1 的 Windows 桌面宿主是早期验证门槛；未通过时可以继续开发明确标识的降级预览，但不能宣称桌面小组件完成，也不能用普通非置顶窗口替代宿主验证。

后续阶段应实现 `dev`、`check`、`test:integration`、`test:e2e`、`build`、`dist:win` 项目脚本。没有实现的脚本不能输出假的成功。

所有通过结论必须对应实际命令、退出状态和测试环境。Browser/UI 检查、Electron 运行时检查、Windows Shell/输入法人工检查分别报告。Linux 或 WSL 下通过不代表 Windows 桌面行为通过。

跨天测试使用可注入 Clock 和明确时区；不修改用户系统时间，不要求真实等待一天。原生 SQLite 驱动必须在所选 Electron 运行时与打包产物中验证。

不清理真实用户数据、不终止用户无关进程、不绕过沙箱权限。资源管理器重启等可能打断工作的测试，提供明确人工步骤或在明确授权的测试环境执行。

## 阶段结束报告
更新 `docs/PROGRESS.md`，给出：本阶段完成项、真实 agent 分工、文件变更、执行命令与结果、截图/日志证据、已知问题及下一阶段入口。

状态只使用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN`。没有验证就是 NOT_RUN，不能写“预计通过”。存在桌面驻留核心缺口时，即使业务可运行也只能标注“开发预览，桌面验收未完成”。
