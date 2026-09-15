执行阶段 6：原型集成验证、Windows 打包与交付文档。不要新增功能。

委派 QA 检查完整验收矩阵，Desktop agent 修复桌面生命周期/DPI/恢复相关缺陷，UI agent 检查中英文、两种主题、系统跟随与不同尺寸的真实画面；Data 缺陷按需串行交还 owner 修复。你统一集成、打包并重新执行检查。

执行项目已实现的 check、test:integration、test:e2e、build、dist:win，分别记录实际命令、退出状态、环境及证据。Playwright Electron 自动化只用于其能覆盖的范围；Win+D、真实中文输入法、Explorer 重启等另做真实 Windows 检查或明确人工 NOT_RUN。

打包产物不依赖开发服务器或云端；关闭 dev server，使用含中文和空格的测试路径，验证 SQLite 原生模块、native helper、静态资源和数据迁移。普通启动不得创建 demo 数据。开发版、测试版与最终 userData 必须分离。

提供托盘的显示/隐藏、打开 Library、设置与退出入口；明确关闭窗口与退出应用的区别。开机启动仅做可选开关且默认关闭，不擅自修改用户登录启动配置。

测量发布版各进程合计内存、闲置 CPU 和启动表现，注明配置与方法；不虚构“小于某个 MB”的结论。检查轮询、后台动画、窗口监听和数据库连接泄漏。

输出 README 的 Windows 安装/启动/构建步骤、实际数据路径、导出与删除副本边界、桌面模式状态及已知问题。输出 docs/RELEASE-CHECKLIST.md 和 docs/PROGRESS.md，区分自动 PASS、人工 PASS、FAIL、BLOCKED、NOT_RUN。

核心业务通过而真实桌面宿主未通过时，只能交付“开发预览，桌面验收未完成”，不能标为完整桌面小组件。未测试的 Windows/DPI/显示器组合不得宣称支持。完成本轮验证与可执行修复后停止。
