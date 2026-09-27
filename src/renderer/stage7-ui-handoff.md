# STAGE7-UI 最小缺口修复交接

2026-09-27：renderer 已冻结并通知 Lead 可构建/串行验证。本 owner 未运行 Git、build、native、GUI 或 Electron，未委派，未修改公共契约或其他 owner 路径。读取 PRODUCT/ACCEPTANCE/PROGRESS/CONTRACTS 与实际冻结 API；不新增业务接口或日期资格规则。

## 真实局部证据

| 命令 | 状态/退出码 | 结果与范围 |
| --- | --- | --- |
| `npx vitest run --config src/renderer/vitest.config.ts src/renderer/src/Stage7Regression.test.tsx` 修复前 | FAIL / 1 | 6/6 RED：编辑入口缺失、runtime 未订阅、Widget 未跨日重新查询、Host 未轮询、Capture 与 Daily Log 未准备退出 |
| 同命令，追加竞态、部分接线后 | FAIL / 1 | 明确复现延迟旧草稿读取覆盖已保存新表单、Esc 与提交交叉、Library A/B 详情逆序、超限无明确提示；保留失败断言 |
| `npx tsc --noEmit` 过程性 | FAIL / 1 | 本 owner 新测试 fixture/refs/事件字段的类型问题已修正；未用 any 掩盖，未改 shared |
| `npx tsc --noEmit` 最终 | PASS / 0 | 全项目只读类型检查，无输出、退出 0 |
| `npx vitest run --config src/renderer/vitest.config.ts` 最终 | PASS / 0 | 4 文件 26/26：Stage7 22 项、原局部 4 项 |
| 本 owner 真实 Electron/SQLite/截图/IME/桌面测试 | NOT_RUN | 由 Lead 串行构建运行；局部通过不是产品路径通过 |

Stage7 局部测试是 Node 内受控 React hook 与 API 边界探针；没有新增 DOM/测试依赖，也没有模拟数据库后宣称持久化通过。覆盖编辑命令 payload/revision、文档清单不派生任务、冲突保留、取消不写、日期单独 reschedule/组合 update、应用时区转换、保留未修改 UTC 秒/毫秒、全天结束日排他边界、历史任务重开、日期跟随/旧日固定、读取逆序/删除清正文、Host 旧响应与卸载清 timer、Capture 退出等待/失败/交叉 gate/超限、Daily Log 多日期 flush 与冲突、监听释放。

Lead 已报告旧 out 的 `stage7-reading-race.mjs` order、delete、capture 三项分别真实 RED/退出 1。capture 门控真实 getDraft 返回，在 r2 已持久化后释放旧 r1，复现“旧读取覆盖新表单”，不等同于数据库 r2 丢失。最初 locale=`en` 的非法 harness 输入已修为 `en-US`，该次只属 harness 错误，不计产品 RED。这些是 Lead 的执行证据，不计为本 owner 执行。后续 GREEN 必须来自新构建，保留断言。

## 文件与实现

- `src/renderer/src/App.tsx`：订阅 runtime 并重读 bootstrap；释放订阅；刷新失败保持已挂载编辑器，显示错误/重试，不因刷新错误丢当前输入。
- `WidgetView.tsx`：currentDate 变化重新取服务端 Widget 聚合；保留小窗口日程时间标记。
- `HostBadge.tsx`：10 秒只读 getStatus、请求 generation 与卸载清 timer；retry 仍是用户主动点击，不改 OS 设置。
- `CaptureView.tsx`：退出等待 submit/hide 后 flush 最新草稿，失败 false；editEpoch + read generation 使编辑/成功保存/提交失效旧读取；hide/submit/quit 交叉互斥，处理中禁交叉控件；>1,000,000 字符明确提示、完整保留且不发超限写入。不声称该旧读竞态导致数据库正文丢失。
- `DailyLogPanel.tsx`：正常退出循环保存所有按 date 缓存 dirty 手写补充；失败/冲突拒绝退出并显示日期和错误；成功保存失效旧读取。沿用 Lead preload 的同窗口多监听聚合，卸载取消订阅。
- `LibraryView.tsx`：实体编辑入口、选中历史任务重新打开；today 跟随运行时日期，明确选择旧日不跳转；详情 generation/目标引用防 A→B、mode/context/date 后旧响应重选；涉及选中实体的 entityRefs 通知刷新详情/历史，NOT_FOUND 或 trashed 清掉托管正文；dirty 编辑阻止切项目/模式/日期而提示保存或取消。
- 新增 `EntityEditor.tsx`：标题/Markdown、任务 planDate/dueDate 分开、定时 UTC/应用时区与全天排他结束日。沿用已冻结 schema 与 notes.update/tasks.update/reschedule/schedules.update。固定打开时 revision，冲突/失败留输入、同表单重试复用幂等 key，取消不写。dirty/inflight 退出返回 false，显示明确保存/取消提示；没有自动提交未保存实体编辑。
- `i18n.ts`：新增必要双语编辑/重开/排他结束日/退出与超限提示。
- `styles.css`：最小编辑器布局；紧凑 Widget 时间行不再随 item-meta 隐藏。
- 新增 `Stage7Regression.test.tsx` 与本交接报告；未修改 Stage6 失败历史或截图证据。

## Selector 交接

必要契约：`entity-edit-open`、`entity-edit-body`、`entity-edit-save`。

附加：`entity-edit-title`、`entity-edit-plan-date`、`entity-edit-due-date`、`entity-edit-start`、`entity-edit-end`、`entity-edit-cancel`、`entity-edit-error`、`entity-task-reopen`、`capture-length-error`、`daily-log-quit-error`、`widget-schedule-time`。字段均有可访问 label；全天 end 为“不包含结束日”，定时边界标注 bootstrap 应用时区。

## Lead 后续/未验证

- 新生产构建后的 stage7-editor/runtime-refresh/quit-draft/reading-race、任务/两种日程完整编辑与真实故障路径：本 owner NOT_RUN，Lead 整合。
- 真实 quit 多窗口/多监听聚合、nonce/main-frame 授权与超时属于 Lead 实现和测试；renderer 沿用签名不变。Library 未保存实体编辑刻意阻止退出，不静默丢弃或擅自保存。
- 修改后中英三主题、320×240 日程时间与编辑器布局截图：NOT_RUN，待 Lead 串行生成后独立实际打开复核。未检查画面不标视觉 PASS。
- 真实系统主题变化/持续跨日/唤醒、桌面 fallback 与 IME、发布产物：本 owner NOT_RUN；局部探针不替代这些。
- 文档总进度/验收与 Git 由 Lead 维护。本 owner 不写 docs 或其他路径。
