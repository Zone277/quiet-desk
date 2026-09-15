继续 QuietDesk 项目，但先恢复上下文，不要从零重建。

读取 AGENTS.md、PRODUCT、ACCEPTANCE、PROGRESS、CONTRACTS 和最近 review。检查实际 Git diff、项目脚本和已有代码，验证进度文档与代码一致。将上次中断的分支、未完成 agent 任务及未提交改动记录下来，不覆盖用户修改。

选择“上次明确指定但未完成的阶段”继续；若它已完成，则只报告当前状态与下一个阶段入口，不擅自全量推进。不要依靠聊天记忆判断需求。

按原所有权与真实子 agent 能力派发小任务，必要时先串行解除公共接口冲突。只修本阶段阻塞、执行适用测试并更新 PROGRESS。没有运行过的 Windows/人工检查保持 NOT_RUN。
