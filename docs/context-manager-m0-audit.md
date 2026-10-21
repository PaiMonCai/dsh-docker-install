# Context Manager M0：固定快照审计与升级结论

> 2026-10-21 的本地审计记录。基线为 `main@6d4d79b`；本阶段交付审计工具、
> 旧日志样例和 CI 门禁。**暂不进入 PR B / M1 的依赖升级**。
> [实施方案](context-manager-upstream-first-plan.md) / [功能对照矩阵](context-manager-upstream-parity-matrix.md)

## 结论与阻断项

1. npm registry 的稳定 `latest` 实测仍为 `acp-kernel@0.0.101`，发布时间为
   `2026-10-03T07:51:48.842Z`。本次评估快照声明的 `0.0.147` **没有对应已发布版本**。
   两个版本来自不同仓库快照，较高的源码版本号不能替代发布包或兼容性证据。
2. `ranxianglei/billion-context@bc4a3f87e2dc98e82df6f707d362e75492fdf3d1`
   的完整干净构建失败。Node `24.14.1` / Windows 下，JS bundle 生成成功，
   声明生成返回 exit code `2`，产生 127 个 TypeScript 错误，包含 `TS7016`、
   `TS2339`、`TS2345`、`TS2353`。首个根因线索是 `src/wire/bili-message.ts`
   自引用 `acp-kernel` 时，干净构建尚未提供对应声明；后续出现 `BiliMessage`
   属性无法解析的错误。原始源码未修补，失败日志保留在审计产物中。
3. 根导出实际从 271 项变为 258 项：新增 10 项，移除 23 项；19 项已有导出声明
   发生变化。移除项主要属于图片压缩/恢复，例如 `applyImageFull`、
   `resolveImageCompressionConfig`。这不是纯新增 API 的升级。
4. 旧状态和默认配置存在差异，需要兼容设计：默认 `preserveRecentMessages`
   从 5 改为 3，默认 `imageCompression` 配置及若干图片状态初始字段被移除。
   当前 DSH 适配器显式覆盖部分默认值；不能把这份默认配置 diff 当作已发生的运行行为变化。
5. 正常镜像、AgentLoop、原生 CompactionEngine 与 Linux 回归须由当前 PR 的
   Actions 单独证明。审计工作流成功只表示证据采集成功；候选构建失败依旧阻断升级。

因此保持运行依赖 `0.0.101` 和现有默认关闭的 ACP/CCR 标志。下阶段应先明确
“等待可重复的正式发布包”或“另行评审固定 SHA、修复构建并完整记录差异的源码包”
这条依赖路径，并说明被移除 API、已有非空图片状态的读取兼容策略。
本次不把未成功构建的 bundle 作为可部署候选，也不覆盖已有 Session 记录。

## 可复验交付物

| 交付物 | 位置与核验方式 |
|---|---|
| 来源、版本和校验值 | `ci/acp-kernel-audit/snapshot.json`：完整 commit、Kernel Git tree、tarball SRI、包/lockfile/许可证 SHA-256 |
| 测试依赖锁定 | `ci/acp-kernel-audit/package-lock.json`：真实 DSH Session `0.2.1-rc.2` 与 Kernel `0.0.101`，独立于运行插件 |
| 可重复审计 | `ci/acp-kernel-audit/run.mjs`：真实 npm view、tarball 比对、222 个固定上游 Git blob 核验、隔离安装和原始构建 |
| API / ABI 对比 | `api-baseline.json` / `api-candidate.json` / `api-diff.json`，由 CI 产物提供实际 ESM 导出与完整规范化声明差异 |
| 本地结果快照 | `ci/acp-kernel-audit/evidence.json`：仅代表所记载平台的本地运行，不代表后续 SHA 的 CI |
| 旧日志黄金样例 | `tests/fixtures/context-manager/acp-0.0.101-session.json`：合成数据、固定校验值、正常测试只读 |
| 回放与分层探针 | `tests/test-context-manager-kernel-audit.mjs` / `tests/lib/context-manager-legacy-probe.mjs` |
| 镜像内旧样例回放 | `tests/test-context-manager-m0-native.mjs`：接入 Dockerfile，调用镜像实际安装的 DSH Session / Kernel |
| CI | `.github/workflows/context-manager-kernel-audit.yml`：Ubuntu / Windows 独立审计并上传日志、声明和诊断构建产物 |
| 完整许可证 | `ci/acp-kernel-audit/*LICENSE.txt`：保留 npm 原包及固定快照的全文 |

复现说明和产物定义见 [审计工具 README](../ci/acp-kernel-audit/README.md)。

## 宿主调用链、兼容入口与后续所有权

| 能力 | 本次核验的上游 API / 差异 | DSH 调用链、保留入口与验收要求 |
|---|---|---|
| Core 与分层 | `createCore`、`createInitialState`、`defaultConfig`、`collectBlockContent`、`summaryMessageId` 均存在；Core 方法名和包的 4 个 exports 路径未变 | `agent/pre-step → AcpRuntime.processPending → DSH compactRegion → 原生 checkpoint → ACP state`；事务与 flush 仍由 DSH 负责 |
| 消息/状态 | `CompressionState`、`Config`、`ProcessTurnInput` 等声明变化，完整清单在证据中 | `DSH snapshotEvents → replayAcpState → Kernel 投影`；保留 `bN`、`mNNNNN` 和 seq→block checkpoint 映射；不迁移/覆盖原记录 |
| CCR / Store | 仍有 `storeLargeResults`、`applyRetrieve`、`createContentStore`；后续须对照具体声明与效果计划 | `tools/post-execute → appendPluginRecord → sessions.flush → 占位符`；`acp_ccr_retrieve`、旧 `ccr:SEQ` 兼容；原文先持久化 |
| Nudge / Prompts | `renderNudgeText` 声明变化，新增 `ONE_CALL_HINT`；`defaultPrompts`、`resolvePrompts` 仍有导出 | `AcpRuntime.nudgeMessage → systemPrompt.context`；本次未替换自制模板，PR D 才做行为对齐 |
| Search | `searchBlocks`、`searchBlocksAsync` 仍有导出；Core `search` 入口未变 | `acp_search_context → AcpRuntime.search`；当前 exact fallback 保留到 PR D 验证后再删除 |
| 缓存账本 | `buildCacheReport`、`decomposeSample`、`computeFoldEconomics` 存在，`FoldEconomics` 声明变化 | PR E 再接 Provider usage port；本次未增加缓存命中率、费用或性能实测声明 |
| 工具/媒体保护 | 新增 `collectProtectedToolCallIds`、`hasUnrecoverableMediaPayload`、`isMessageProtectedWithPairing`，图片压缩导出被移除 | Native `compactRegion` 再校验工具边界；媒体/PTC 尚未覆盖的恢复与权限情形继续阻断相应接管 |
| Persist / Wire | 包路径未变化；成功加载核心模块不证明 wire 类型构建正确 | DSH Session 是唯一事实来源；上游 persist 不接管会话，wire/代理实现不进入 DSH 运行链 |

完整声明差异保存在 CI 产物中，包含移除项，不能只按这张表的常用 API 推断兼容。

## 验证结果与范围

- 新增审计回归：本地 7 项通过，覆盖两版 Kernel 的冻结旧日志读取、T1→T2→T3
  桥接语义、精确原文读取、缺失 ACK、未关闭事务、伪造来源拒绝、fork 隔离、
  CCR 持久化失败与跨 Session 读取拒绝，以及 diff 工具的移除项检测。
- 上游固定快照 Kernel 测试：1,397 项通过、零跳过；原始 TAP 日志在 CI 产物中。
  这与完整干净构建失败并不矛盾，测试通过不替代类型/发布包构建通过。
- 回放样例使用真实 `Session.create/append/appendPluginRecord`，内容全部合成。
  压缩事务为受控原生事件替身，**不是完整 CompactionEngine、持久卷冷启动或模型质量验收**。
- 既有 Phase 2/3 在本机 Windows 有 5 项失败：目录 fsync、symlink 权限及保存结果的
  连带断言；在干净 `6d4d79b` 临时签出上重现相同 5 项失败。本次没有修改这些实现。
  Linux 和镜像内结果必须查看当前提交的工作流，不能把本地失败记作全绿。
- 本机没有 Docker 可执行文件；真实镜像构建、AgentLoop 与容器运行结果等待当前 PR
  的 Standard 工作流。未使用真实用户会话，未请求真实 Provider，也未产生模型 API 费用。

## 升级门禁与回滚

M0 审计执行可以成功，`decision.upgradeAllowed` 仍固定为 `false`。发现没有正式发布包、
完整构建失败或接口/状态差异时，产出证据并停止 PR B 的版本修改。以后修复必须改变
显式固定的输入，并重新核验 registry、源码、lockfile、许可证与行为；不能把旧快照
的结果沿用为新 commit 的验收。

本次没有迁移运行数据或改变插件配置。撤回审计 PR 只移除测试、文档与工作流输入；
现有运行依赖与会话格式保持原基线。运行开关、共享历史授权、真实 Provider 验收及
正式发布仍按 M5 独立审查。

## 致谢与许可

本项目 Context Manager 使用 [acp-kernel](https://github.com/ranxianglei/acp-kernel)，
其上游项目为 [billion-context](https://github.com/ranxianglei/billion-context)，作者 ranxianglei。
此次核对的 npm `0.0.101` 和候选 Kernel LICENSE 内容相同，均在 MIT 正文后包含
产品可见表面的署名附加条款；项目级 LICENSE 也已保存。这里记录许可文本与署名要求，
不把 package.json 的 `MIT` 字段当作完整许可结论。
