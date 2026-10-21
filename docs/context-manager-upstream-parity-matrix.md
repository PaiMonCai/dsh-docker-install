# DSH 原生 ACP × billion-context 上游复用矩阵

> 本矩阵是 **2026-10-21 的静态设计快照**，不是最终完成度或性能声明。DSH 基线 `main@fb1b2e2`，上游来源 `ranxianglei/billion-context@bc4a3f87`；实际升级以候选发布包 API、许可证及独立 CI 为准。详细方案见 [上游优先原生化实施方案](context-manager-upstream-first-plan.md)。

| 能力 | billion-context 可复用模块 / 已知实现 | DSH 目前状态 | 决策 / 对照验证 |
|---|---|---|---|
| Core 主流程 | `kernel/src/compress.ts`、`pipeline.ts`、`config.ts` | `acp-runtime.mjs` 基于 `acp-kernel@0.0.101` | **升级依赖**，保留 DSH Port；比较新旧 processTurn/applyCompression |
| T1/T2/T3 & block/ref | `boundaries.ts`、`sync.ts`、`block-map.ts`、`refs.ts`、`protected.ts` | DSH 原生压缩 + 版本化事件 + 分层回放已实现 | **上游规则优先**，额外保留原生事务/未闭合工具硬保护 |
| 历史保存与解压 | `decompress.ts`、`content-store.ts`、`persist/*` | DSH 原生 Session 原文、`acp_retrieve` | **复用纯函数**，持久化以 DSH Session 为主 |
| 到达时 CCR | `ccr.ts`、`content-store.ts`、`truncate-tools.ts` | `acp-ccr.mjs` 的文本及 768KiB 上限实验接入 | **替换重复规则**，DSH flush barrier 与现有旧 ref 兼容必须保留 |
| 复杂工具 / PTC | `protected.ts`、`tool-pairs.ts`、`reasoning-pairs.ts` | 单层原生工具测试通过，PTC / 非文本有限 | **阶段性引入**，先构建嵌套/媒体无损和权限测试 |
| Nudge & Prompt | `nudge-text.ts`、`prompts.ts`、`compression-rules.ts`、`packs.ts` | DSH 当前使用自己拼装的有限提示文本 | **优先直接复用**上游文本/增长策略，保留 SystemPrompt 钩子 |
| 搜索 | `search.ts`、`search/*`（注册/算法/缓存） | Kernel 搜索叠加自制 exact-match fallback | **复用搜索算法**，删除自制 fallback，比较召回和排序 |
| 压力/减量 | `truncate.ts`、`absorb.ts`、`crush.ts` | Kernel 部分特性禁用，DSH 保留 Basic 压力 fallback | **按模块灰度**，不能偷换宿主唯一 CompactionEngine |
| Cache Ledger | `cache-report.ts` | 有离线 token 估算；无完整 provider cache 账本 | **复用账本算法**，新增 DSH usage port，未知字段不得伪造 |
| Web 诊断 | `kernel/src/panel/*`、上游 Web / native client | 目前有 `experimentalRuntime` 和只读历史 | **复用模型/视图逻辑**，UI 接 DSH Web 原生权限 |
| 平台集成 | 上游 `src/agent/dsh-native.ts`、`dsh-native-client.ts` | DSH 内有 Agent/Session/Tools/Compaction 原生钩子 | **只借鉴接口需求**，不复制代理/fetch patch/MITM/自动更新 |
| 权限/灰度 | 上游插件有自己的部署边界 | 当前仅单 Standard preset LAB + owner-only 历史 RPC | **DSH 原生改造**，正式共享前独立多租户鉴权验收 |
| 法律与追踪 | 上游 README、源码、`LICENSE`、Kernel `LICENSE` | 现有包声明 MIT，但移植来源需逐项审核 | **保留许可证与显著署名**，注明构建 SHA、包版本和差异 |

## 迁移决策的三种结果

- **Reuse**：上游稳定、导出明确、可以成为唯一算法实现：`ccr`、`search`、`cache-report`、`nudge-text` 等优先走此路径。
- **Adapt**：算法来自上游，但宿主状态/安全/数据生命周期不同：`compress`、`content-store`、`persist`、tool-pair/媒体保护需要 Port Adapter。
- **Do not port**：billion 特定 HTTP 代理、模型请求拦截、SSE wire、MITM、跨客户端启动器与自动更新。不属于 DSH 原生化目标。

## PR A（最先落地的任务）输出格式

对每个候选模块补充：上游固定 commit 或 npm tarball checksum、旧 API → 新 API、必要 shim、状态 schema 差异、原始事件回放 fixture、涉及的 DSH 生命周期钩子、导入依赖、许可审查、现有工具名称迁移、降级/回滚方式、实际 CI 证据。

**明确禁止：**仅改 npm 版本就宣称完成移植；仅用 Core 单元测试替代 DSH Agent Loop 与冷 Session 回放；用上游性能宣传代替我们自己的实测。
