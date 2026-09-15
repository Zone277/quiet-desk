执行阶段 2：建立稳定脚手架、公共契约和真实存储烟雾测试。

你作为 Lead 拥有依赖、构建、src/shared、preload 和 IPC 定义。请 Data agent 与 UI agent 分别只读提出必需的数据操作和界面读取需求，你统一冻结 v1 契约后再安排实现。

建立 main / preload / renderer / shared / domain 分层和 Widget、Capture、Library 三个窗口入口。初始化 npm 项目与兼容版本锁文件；保留阶段 1 桌面适配器，不另起一套窗口实现。创建 dev、check、test:integration、test:e2e、build、dist:win 的真实项目脚本；未实现的测试不可返回虚假通过。

定义任务、笔记、日程、草稿、Daily Log 的最小类型及各自约束。计划日期/截止日期/完成时间分开；定时日程与全天日期段区分；定义应用时区与可注入 Clock。IPC 包含运行时验证、明确错误结果、请求幂等标识和跨窗口更新订阅。

写 docs/CONTRACTS.md，固定时间边界、同日完成再打开的日志规则、删除传播、草稿提交事务，以及接口所有权。不要引入完整事件溯源框架或未使用的抽象层。

由 Data agent 实现最小 SQLite 建库、迁移、写一条/读一条/关闭重开的烟雾测试；务必在实际 Electron 运行时执行，不以普通 Node 中成功代替。若原生驱动涉及不同 ABI，隔离测试与 Electron 构建，避免并行互相重建同一依赖。

验证 contextIsolation/sandbox、renderer 无 Node/数据库访问、preload 只能调用已列出的能力。演示/测试从独立目录启动，不能触及正式数据。

阶段完成标准：三个窗口空壳可启动、真实数据库可读写重启、公共类型与契约测试通过、后续文件所有权明确。记录无法执行的项目，然后停止。
