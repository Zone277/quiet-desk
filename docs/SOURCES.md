# 官方资料与使用边界

核查日期：2026-09-14。资料描述当前文档，不保证用户已安装的客户端具有完全相同的能力；阶段 0 必须检查实际环境。下列资料用于确认平台行为，产品规格与阶段分工是本提示词包的工程设计建议。

阶段 0 于 2026-09-15 重新打开并核对 S1、S5、S6、S7、S8；其余条目沿用上述核查日期。实际能力仍以 `docs/PROGRESS.md` 的本机检查为准。

- S1 OpenAI：Subagents。当前文档说明本地 Codex 的子 agent 工作流、显式委派和多 agent 开销；不是仅在提示词中列角色名就等于实际运行子 agent。`https://learn.chatgpt.com/docs/agent-configuration/subagents`
- S2 OpenAI：Custom instructions with AGENTS.md。说明项目指导文件的发现与覆盖。`https://learn.chatgpt.com/docs/agent-configuration/agents-md`
- S3 OpenAI：Worktrees。独立工作树用于平行会话隔离，仍需集成与验证。`https://learn.chatgpt.com/docs/environments/git-worktrees`
- S4 OpenAI：Windows sandbox。说明原生 Windows/PowerShell 及权限边界。`https://learn.chatgpt.com/docs/windows/windows-sandbox`
- S5 Electron：Custom Window Styles。透明窗口有缩放限制，不能把 CSS 材料效果直接等同为系统背景模糊。`https://www.electronjs.org/docs/latest/tutorial/custom-window-styles`
- S6 Microsoft：SetParent。窗口父子关系、样式及不同 DPI 感知模式的注意事项；不保证 Shell 桌面内部结构稳定。`https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent`
- S7 Electron：Native Node Modules。原生模块需要适配 Electron 运行时。`https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules`
- S8 Electron：Security。进程隔离、受控 IPC、外链处理与相关安全建议。`https://www.electronjs.org/docs/latest/tutorial/security`
- S9 react-markdown：项目官方仓库与文档。Markdown 渲染和扩展能力。`https://github.com/remarkjs/react-markdown`
- S10 Playwright：Electron。Electron 自动化当前仍标为实验支持，不能代替真实桌面 Shell/IME 验证。`https://playwright.dev/docs/api/class-electron`
- S11 electron-vite：Getting Started。开发构建入口。`https://electron-vite.org/guide/`
- S12 electron-builder：项目文档。桌面应用打包能力与配置。`https://www.electron.build/`
