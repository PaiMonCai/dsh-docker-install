# DSH Context Manager：billion-context 上游优先原生化实施方案

> **文档性质：待执行的设计与验收规范（2026-10-21）**。本 PR 只提交方案、对照表和索引，不升级依赖、不切换 ACP/CCR 开关、不更改容器运行行为。当前 Phase 8–11 的代码基线已在 `main`（`fb1b2e203ad129c8d15c0cc459fb8d2016c4eb57`），详见 [既有实现说明](context-manager-phase8-11.md)。
>
> **一句话目标**：把 billion-context 的 **ACP 算法和可复用模块**尽可能原样引入 DSH，DSH 的 **Agent / ToolRuntime / CompactionEngine / Session** 仍是唯一宿主与持久化事实来源；**不照搬 HTTP 代理、全局 fetch patch 或独立模型转发链**。

## 0. 基线、信息来源与边界

- DSH 本仓库基线：`main@fb1b2e203ad129c8d15c0cc459fb8d2016c4eb57`，`docker/plugins/dsh-context-manager/package.json` 固定 `acp-kernel=0.0.101`。
- 上游评估快照：`ranxianglei/billion-context@bc4a3f87e2dc98e82df6f707d362e75492fdf3d1`（`master`）；`kernel/package.json` 的**源码版本声明**为 `0.0.147`。**不能据此断言 npm 已发布该版本**，实际候选版本须通过 npm registry、lockfile、dist exports、构建产物与校验值核验。
- 参考：[上游 Kernel API](https://github.com/ranxianglei/billion-context/blob/bc4a3f87e2dc98e82df6f707d362e75492fdf3d1/kernel/src/index.ts)、[Kernel 设计](https://github.com/ranxianglei/billion-context/blob/bc4a3f87e2dc98e82df6f707d362e75492fdf3d1/kernel/DESIGN.md)、[上游 DSH 插件](https://github.com/ranxianglei/billion-context/blob/bc4a3f87e2dc98e82df6f707d362e75492fdf3d1/src/agent/dsh-native.ts)、[本仓库现状](../docker/plugins/dsh-context-manager/acp-runtime.mjs)。
- 行为对照与工作拆分请同时阅读：[上游功能对照矩阵](context-manager-upstream-parity-matrix.md)。
- 只接受**渐进式、可撤销的依赖升级**。不将某个分支 HEAD 当作可重复生产依赖；若必须移植尚未发布的源码，固定完整 commit SHA、独立构建和许可证清单，等待版本发布后恢复包依赖。
- 保持 `DSH_CONTEXT_MANAGER_ACP_ACTIVE=0`、`DSH_CONTEXT_MANAGER_CCR_ACTIVE=0` 等默认禁用语义；现有 Standard 单 Preset 隔离门禁在正式验收前不放松；Reverse/Research 不因共享镜像而自动获得接管资格。
- 与上游 billion 插件做“**能力对齐**”，不是复制代理、客户端安装器、MITM、SSE 改写、Web 代理后台；如果一项能力只能在 Wire 层成立，必须先设计等价的 **DSH 原生数据事件 / 生命周期钩子**，不能静默跳过。

## 1. 架构边界与技术决策

```text
DSH Web / Agent / Model Router (官方宿主)
     |
     +-- DSH ToolRuntime   <- ACP 工具、CCR 收到工具结果时的入站钩子
     +-- DSH SystemPrompt  <- Kernel 的 Nudge / 规则 / 可见 Ref 指南
     +-- DSH Session       <- 唯一可信事件日志：原文、索引、ACP 状态、CCR 记录
     +-- DSH CompactionEngine <- 唯一执行 CompactRegion / 原生检查点者
             |
     dsh-context-manager/adapter       [我们自己维护的薄适配]
             |
     acp-kernel (上游固定、可独立升级)
       ├─ processTurn / applyCompression / T1 T2 T3 / refs / protect
       ├─ CCR / content-store / truncate / absorb / crush
       ├─ nudge-text / prompts / packs / rules / output-steering
       ├─ search (BM25 / fuzzy / hybrid / etc.，以当前导出为准)
       ├─ cache-report / fold-economics
       └─ 状态和回放辅助纯函数
```

**四个不得破坏的宿主合同**：

1. **DSH 日志唯一事实源**：Kernel State 是投影，任何改变可见 Surface 的操作，必须经**原生** `ctx.compaction.compactRegion` 或 DSH 支持的合法 Surface 操作；不得直接把 Kernel `messages` 数组覆盖宿主会话。压缩的原始消息、工具调用与结果保持可恢复。
2. **一个压缩主人**：一个 Agent 实例只有一个有效 CompactionEngine；DSH 自动压力处理/超窗恢复依旧可用；排除同时安装或路由到 billion 代理的双重压缩。内置门禁的“无代理”环境标志目前只是运维断言，后续需增加可观测证据。
3. **调用链与缓存稳定性**：工具调用/result 配对、未闭合 step、system/developer 消息与多模态对象不能跨界压缩；Nudge/refs 不破坏工具 JSON，也不让旧前缀每轮无意义变化。
4. **原文先落盘再引用**：CCR 必须经过 DSH 持久化确认后才能把模型可见内容换成占位符；未知类型、写入失败、内容超预算、权限不明一律 fail-open 保留原文（不默默丢数据），ACP 异常时默认退回原生 Basic 行为。

**代码归属原则**：

- 算法：只保留上游模块调用、版本兼容 shim 和 DSH 特定的约束；不要再长期维护独立的二次 CCR 判定、排序/检索、Nudge 模板或 cache-economics 算法。
- DSH 适配：保留 `acp-runtime.mjs`、`acp-native.js`、`acp-recovery.mjs`、`tiered-backend.mjs`、`takeover.mjs`、历史读取权限边界，但持续减少其中可被上游覆盖的纯算法。
- 不从上游 `src/agent/dsh-native.ts` 拷贝代理管理、`globalThis.fetch` patch、客户端代理 URL、MITM、上游 SSE/wire 重写、自动重装逻辑。
- 不擅自把 Kernel 的 `persist` 文件存储当作第二份真实会话；只复用其纯状态编码/迁移辅助，存储仍遵守 DSH `appendPluginRecord` + `ctx.sessions.flush`。

## 2. 六组迁移工作（按依赖顺序）

### M0｜冻结清单与兼容性审计（第一份实现 PR 的前置）

- 从当前 DSH 主分支、billion 评估快照、实际发布的 `acp-kernel` 包建立 `component → current API → candidate API → behavior → owner → tests` 清单；与 [功能对照矩阵](context-manager-upstream-parity-matrix.md) 对齐。
- 对比 `0.0.101` 与候选**实际已发布版本**的 `createCore`、`processTurn`、`applyCompression`、`CoreMessage`、`CompressionState`、`Config`、`search`、`ccr`、导出路径和默认行为。
- 保存真实 `npm view` 版本、包 tarball integrity、依赖树、lockfile、许可证全文与构建 Node 兼容性；先在 **仅测试的分支**完整跑老测试。禁止 `^latest` / 浮动 `master`。
- 做一次旧状态的读取演练：旧 ACP Plugin Record、`bN` ID、`mNNNNN` 映射、checkpoint seq、CCR `ccr:SEQ` 引用跨升级可读；若 schema 不兼容，编写 **versioned read adapter**，禁止覆盖旧记录。
- **完成定义**：输出可审计 API diff、固定依赖的构建产物、兼容性失败清单；所有既有回放/镜像测试不退化。若新版本行为与关键宿主合同冲突，保留 `0.0.101`，先提交兼容设计 PR。

### M1｜升级上游 Kernel，删除重复压缩决策实现

- 保持现有原生 compaction transaction 不动，先替换 Kernel 版本与 Port 映射（事件序号、工具配对信息、多模态保护、真实 Context Window）。
- 采用上游 `resolveBoundaries`、`syncBlocks`、`compress-tools` / `parseCompressArgs`、`protected` 等规则，替代 DSH 适配器中不必要的自制范围和 Block 存活推断。原生 `compactRegion` 必须**再次**检验平衡性。
- 基于上游 `processTurn/applyCompression` 生成 Kernel **决策和状态**，状态写入继续使用 DSH 意图事件→持久化→原生压缩→ACP 状态事件→持久化。多个运行时竞争时日志权威快照先行。
- **完成定义**：同一批包含 1–3 层压缩、稀疏 ID、工具配对、重复 tool call ID、seeded fork 的 golden fixture，在上游纯 Kernel 和 DSH 适配两端可比对语义；拒绝非法 range；重启无丢 Block 和原文。

### M2｜直接采用上游 CCR、Content Store、Truncate / Absorb / Crush

- 优先复用 `kernel/src/ccr.ts` 的 `resolveCcrConfig`、占位符生成/解析与 `storeLargeResults/applyRetrieve`，以及 `content-store.ts`、`truncate-tools.ts`。保持 **DSH 工具到达时** 的 `tools/post-execute`，但 Kernel 返回的是效果计划，适配器负责写入原生日志和回取。
- 设计 **ContentStorePort**：`putOriginal(session,toolCallId,content)`、`getOriginal(session,ref,page)`、`commitBarrier(session)`。优先绑定 DSH 事件日志，并证明 canonical ref 不会与 Kernel `mN` 或旧 `ccr:SEQ` 混淆；若 Kernel 需另一索引，索引为可重建的缓存，而非第二事实源。
- 对 DSH 原生父/子 Agent、PTC 嵌套工具调用分别设计范围、所有权、请求者身份和回取路径；非文本与媒体内容只在能无损持久化与鉴权后启用，否则保持不修改。严禁只按预览文本估算媒体可恢复性。
- 旧 `acp_ccr_retrieve` / `acp_retrieve` 保留兼容别名，增加版本化的 Canonical `retrieve` 层，不允许用户需要跨版本手工修复旧引用。
- 确认磁盘压力、单 Session 配额、清理/归档、压缩后多次检索、历史回放和撤销时的引用有效性。测试：大文本、JSON、二进制/图片、失败/取消、截断、重试、双层工具、Fork、无法写入存储等。
- **完成定义**：上游 CCR golden fixture 与 DSH 的入站结果一致；新旧引用兼容；确实经过 DSH `flush` 才输出占位符；未覆盖类型和写入失败不丢字节。

### M3｜Nudge、Prompt、Search 和压缩规则上游对齐

- Nudge：采用 `renderNudgeText`、`defaultPrompts/resolvePrompts`、`compression-rules`、`packs`，DSH 只负责用 `ctx.systemPrompt.context` 安全投递，**不要重写静态模板**。Kernel 的增长触发以真实可见窗口和本地/Provider 用量来源校准。
- Search：将目前 `core.search + 自制低分 exact fallback` 改为复用上游 `searchBlocks/searchBlocksAsync` 和算法注册/文档缓存；搜索服务不得越过当前 Agent Session 访问别人的 block。上游没有某项特定配置时以 API 实测为准，不臆测功能。
- 首次 prompt 模板、摘要保存优先级、最近消息保护、上下文范围和工具调用 JSON 不变；若变化属于上游有意行为，产出 diff 和迁移说明。
- **完成定义**：Nudge 是否出现/何时出现、模型工具描述、中文/英文搜索、短块关键词、相关度排序、引用回取的对照 fixture 通过；上下文前缀不受非必要的每轮文本重写影响。

### M4｜Cache Ledger 与性能观测（上游算法，DSH 真实计量）

- 复用 `buildCacheReport`、`decomposeSample`、`computeFoldEconomics`、`formatCacheReport`；DSH 侧增加 **provider usage normalization port**：`input`、`cached`、`output`、时刻、模型、路由与 fold 事件。
- 区分“Provider 实际返回的缓存 tokens”“本地估算”与“无该字段/未知”。Anthropic、OpenAI 兼容的 cache usage 统计方式不完全相同，必须标准化并保留未归因项，不得把没有实测的缓存读取补成 0 再对外宣称命中率。
- 缓存指标只可对同一种 Provider/模型/会话边界做意义明确的比较；价格配置/缓存写读比例明示。追踪摘要本身的 token 开销与尾部重新缓存的成本。
- Web 新增只读面板或 `/acp-cache` 等价 DSH 指令，提供可见 Context、折叠、Cache Ledger 和状态恢复情况；**不可暴露跨用户原文**。
- **完成定义**：上游 Cache Ledger golden 测试恒等式严格对账；至少一个真实支持用量字段的 Provider 的受控长会话实验，覆盖 token / cache / latency / 成本，不把离线估算冒充账单。

### M5｜原生安全、用户权限、功能矩阵与灰度发布

- Session Fork / replay 的读写竞争、进程中断、旧 schema、压缩事务部分落盘、不同 Agent 同时启动；故障注入必须包含缺失 ACK、重复意图、含未关闭 step、混合媒体、外部 provider overflow。
- Web 历史内容如果要给共享实例使用，先接入带 principal 与 session resource 授权的 Typert Remote；现有 owner-only `Connection RPC` 不得通过简单改开关扩大到多租户。
- 分开验收 **Standard、Reverse、Research / Web 各 Preset**。每个 Preset 的唯一压缩主人、ToolRuntime、Provider Router、CCR 和 model usage 必须来自活跃运行实例的证据，不能只读取配置。
- 保留 feature flags：`ACP_ACTIVE`、`CCR_ACTIVE`、后续按 capability 开启的可选功能；可按实例灰度 0% → 单人独立试点 → 指定 Preset → 更广范围。每一级必须具备故障回退与会话冷恢复。
- 正式启用之前，验证关闭标志并重建容器后**旧 Session 仍可读**、原始日志未被抹除、基础压缩可用，不依赖新的索引才能打开已有会话。
- **完成定义**：PR 级 CI、隔离 Docker 端到端、真实 Provider 受控验收、租户隔离测试和回滚演练都有可审计结果；只有满足全部门禁才允许默认启用。

## 3. 推荐 PR 拆分（每个 PR 独立回滚，不一次性大重构）

| PR | 交付物 | 前置与阻断检查 |
|---|---|---|
| A — API/ABI audit | 上游快照、registry 证据、API diff、旧事件 schema golden fixture、License/SBOM 核对 | 无代码接管；出迁移结论后再升级 |
| B — Kernel upgrade | 固定新版本、薄 Port Adapter、T1/T2/T3/refs/保护规则对齐 | 原生事务/工具结果配对/旧会话 cold replay 不变 |
| C — CCR + Content Store | 上游 CCR 规则/占位符/Store API + DSH 事件适配、新旧引用兼容 | 原文持久化确认后才缩短，PTC/媒体未覆盖则不启用 |
| D — Prompts + Nudge + Search | 上游 nudge-text、压缩提示词和搜索能力；删除自研 fallback | 搜索/Nudge golden parity，稳定模型前缀 |
| E — Cache ledger + Web | Provider usage Port、缓存收益模型、只读诊断页/命令 | 真实数据与估算显式分离、严格对账 |
| F — Release gate | Fork/并发/失效恢复、授权隔离、跨版本数据、灰度与完整回滚文档 | 不通过则保留实验开关，拒绝生产接管 |

**执行规则**：每个实现 PR 指明“上游 API/commit、DSH 改动文件、被删除的重复代码、测试结果、Feature Flag 和回滚方式”；只改文档的 PR 不会被宣称为功能已交付。后续每次上游升级单独发布依赖 PR。

## 4. 质量与验收矩阵

| 验证维度 | 最少测例 | 必须证明 |
|---|---|---|
| 上游算法对齐 | 上游 golden fixtures、搜索排序、CCRs、Nudge、T1/T2/T3 | 与选定固定版本语义一致，偏差有显式说明 |
| DSH 工具安全 | 真实离线 AgentLoop 多步工具、调用/result 配对、重复 ToolCallId | 不在未平衡工具调用时更改 Surface |
| DSH 持久化 | 基础事务、故障注入、复盘、重复记录与不完整 intent | 冷恢复一致、不会把失败事件认作成功 |
| 压缩边界 | 稀疏 refs、Active Block、跨 checkpoint、最近保护区 | 拒绝非法区域，原文可定位 |
| CCR | 长文本/超限/非文本/双层 PTC/取消/写入失败/跨 Session 引用 | 读回原样，无授权不能访问，不支持时不丢内容 |
| 资源开销 | 36 消息离线基准 + 真实长会话，token/TTFB/RSS/disk/回放耗时 | 分离估算与 provider 实测；给出 before/after |
| 缓存账本 | provider cache 字段、前缀失效、折叠成本归因 | 统计恒等式、无法归因时标记 unknown |
| 用户权限 | 不同用户/Agent/Session、伪造引用、共享 Web 会话 | 拒绝跨租户内容读取 |
| 版本与运维 | 老卷升级、切回 Basic、回滚容器重建、衍生 Edition | 无原文损坏、标志默认关、可恢复 |

**生产准入阈值（决策规则，而非现在已达成）**：所有安全/正确性测试零未解释失败；只读原文跨 Session 访问零绕过；至少两类真实长会话场景中相对于关闭 ACP 的结果无不可接受的关键事实丢失或运行中断，并有可复核的 Provider 用量、成本、缓存和延迟记录。性能不预先承诺具体“节省 5×”或“95% 缓存命中”，阈值应由真实基线和应用负载在 PR E 中提出并固定。

## 5. 版本、许可与长期维护

- **首选 npm 已发布的 `acp-kernel` 固定精确版本**，记录 resolved tarball + integrity + lockfile + 上游 tag/commit；不以 `master` HEAD 替代可重复构建。
- 如果决定 vendoring / cherry-pick，上游源码必须按模块保持原版权与附带许可证；禁止混入其代理和 MITM，完整记录变动来源与修改说明，提供能够复验的 commit SHA 与单元测试。
- 特别注意：`ranxianglei/billion-context/LICENSE` 和 `kernel/LICENSE` **在 MIT 正文之外还写有面向用户的显著署名附加条款**；正式引入前需要确认当前分发包的实际许可证及其适用性，并在 [项目文档或 About/Credits] 中包含对 [billion-context](https://github.com/ranxianglei/billion-context) 和 [acp-kernel](https://github.com/ranxianglei/acp-kernel) 的明确致谢。不能仅以 package.json 的 `license: MIT` 为全部许可结论；必要时进行法律复核。
- 把上游更新同步从“手工比较”提升为按固定 snapshot 执行的差异清单任务：新增导出、行为变更、测试变化、许可证变化、默认配置变化、成本和安全回归均应列入依赖升级 PR。
- `context-manager-phase8-11.md` 属于历史基线说明，其中一些“未实现”的早期描述已被后续提交超越；不以该文档的旧段落推断当前能力。新计划与 [对照矩阵](context-manager-upstream-parity-matrix.md) 是未来实施和验收的入口，实际状态应由代码与最新 CI 证明。

## 6. 现在要做的第一件事

**下一份代码 PR 从 M0 / PR A 开始**，提交固定的候选 npm Kernel 包信息、可机器复验的 API 导出差异与旧日志读取黄金样例。完成该项并通过 CI 后，才进入 PR B 改版本号。无需重写已证明有效的 DSH 原生 Session 事务，优先把高级功能依次替换为上游同源实现。

**本设计文档没有授权：**立即启用生产 ACP/CCR、把共享 Web 历史读取放开、拉取真实用户会话发给模型、产生真实 API 费用，或把本次文档 PR 视为 M0–M5 已完成。
