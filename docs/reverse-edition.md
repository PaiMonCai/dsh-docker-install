# Reverse Edition：不包含 dsh-purge 的独立逆向镜像

此镜像使用 DSH 原生 Agent Preset 提供「逆向工程」Agent，并且预装 REA、Ghidra、JADX、GDB、Frida 和逆向 Skills。不会下载、安装、加载或分发 dsh-purge 的代码、前端和 Host 级补丁。与 Standard 容器/数据卷独立。

## 安装

```bash
bash install.sh reverse
# 或已安装 dshd 的用户
dshd reverse install
dshd reverse status
dshd reverse logs
dshd reverse update
```

手动构建：
```bash
docker compose -f docker-compose.reverse.yml up -d --build
docker compose -f docker-compose.reverse.yml logs -f dsh-reverse
```

默认容器 `dsh-reverse`、端口 `3081`（Compose 仅绑定宿主机回环地址）、独立 DSH_HOME 和工作区。不挂载 Docker Socket，也无需 privileged。

## 保留内容

- 原生「逆向工程」Agent：persona、Shell、文件操作与搜索、Jobs、Todo、用户交互等工具。
- REA 6.4.0：通过 `rea mcp` stdio，在逆向 Agent 作用域内加载，而非修改全局 Agent。
- Ghidra 12.1.4、JADX 1.5.3、JADX Headless MCP、apktool、GDB、strace、ltrace、binutils、patchelf。
- frida-tools 14.11.0、pwntools 4.15.0。
- 九个镜像自有逆向 Skills（位于 `/opt/dsh-reverse/skills/`，启动时复制缺失项到 `$DSH_HOME/reverse-engineering/skills/`），不会覆盖用户文件。

逆向 Agent 来源为仓库的 `reverse/cordis.patch.yml`，镜像启动入口通过 `DSH_REVERSE_AGENT_PATCH` 加载。镜像构建阶段不会联网拉取第三方 Agent 插件源码。

## 与旧版的差异

原 dsh-purge 的 Clean/Apply、系统提示词与权限修改、专有 reverse-workflow-tools、红队演练 Agent 和两个工作台均**已移除**。保留 `reverse-engineering` Agent ID，但预设实现更换为 DSH 自有工具与 REA MCP。

从旧 Reverse 升级前建议备份。镜像升级**不会自动删除持久卷内已有会话或用户自行安装的第三方插件**。若以前手动在持久 Web Profile 安装过 dsh-purge，需单独审计、备份并卸载；不应擅自删除数据卷。

## 验证与限制

CI 检查无旧模块、原生 Agent 声明、安装工具与 Skills，并在 Web 启动后验证实际 Agent Registry。DSH 0.2.1-alpha.2 上发生的 `sessionController unavailable` 仍需单独诊断：用户已经在关闭旧插件的全新容器中复现，单纯删除插件不能保证修复它。

IDA/Hopper 不包含在镜像中；不要对无授权软件动态调试或运行未知可执行文件，容器也不等于绝对隔离。

## 第一批增强：自动初检、静态函数分析和会话健康门禁

新镜像安装固定版本的 LIEF 1.0.0 和 flare-capa 9.4.0，并提供两个只读命令：

```bash
# 样本须位于 /workspace；此命令只检查头部和元数据，不运行样本
reverse-triage /workspace/sample.bin

# 可选的静态能力匹配，带超时控制（capa 规则缺失时会如实报告）
reverse-triage /workspace/sample.bin --capa

# Ghidra 12 Headless：有限函数数量、固定镜像内脚本、自动清理临时项目
reverse-ghidra /workspace/sample.bin --output /workspace/reverse-analysis/ghidra --max-functions 40
```

Triage 输出 `report.json`（`dsh-reverse-evidence/v1`）和 `report.md`，带 SHA-256、工具状态、证据定位与局限。Ghidra 输出 `functions.json`，每个函数附地址及受限长度的伪代码。单文件大小最多 256 MiB，所有读写均限定在 workspace 内；不自动解包、不运行分析目标、不下载运行时工具。

逆向镜像增加 `dsh-reverse-session-health` 插件，仅当 `sessionController` 注入成功时生成临时状态标志。Reverse 专属 Docker HEALTHCHECK 同时检查 Web 和会话标志。CI 再执行真正的 `sessionController.create({ agentPreset: 'reverse-engineering' })`，而非仅验证 Web 端口、Agent 列表。

**注意：该门禁能暴露并阻止坏镜像通过 CI，但不是上游 sessionController 依赖冲突本身的修复。** 如果门禁失败，应收集启动诊断和插件状态，而不是删除用户持久化数据。

为了规避 DSH 上游已记录的 Web Profile 热重载与会话控制器生命周期冲突，Reverse 的 Cordis overlay 默认禁用 `hmr`。修改插件、Profile 或相关补丁后，必须显式重启 Reverse 容器才会生效；Standard 不受影响。

## 原生 Reverse Prompt Manager（仅逆向 Agent）

Reverse Edition 内置 `dsh-reverse-prompt-manager`，通过 DSH 官方的 `system-prompt/assemble` Hook 在**仅** `reverse-engineering` Agent 的 `deployment:persona-prefix` 后增加自定义指令分块，或由管理员选择仅替换该 Agent 的 Persona 分块。其余官方 System Prompt 分块、Plan Mode、工具协议和执行许可保持不变。普通 Agent/Standard 不受影响。不需要 HMR，预设变更从下一次提示词组装生效。

借鉴 `yexi-by/dsh-unrestricted` 的动态组合与保留原始分块、`errorcode7/dsh-prompt-manager` 的预设及预览复用纯函数理念；所有代码为本项目独立实现，**不下载或安装这两个插件**。

内置三个只读预设：`evidence`（证据优先）、`concise`（快速分析）、`architecture`（架构还原）。**默认关闭**，不会在升级时改变现有 Agent 行为。进入容器后：

```bash
reverse-prompt list
reverse-prompt status
reverse-prompt show evidence
reverse-prompt preview evidence
reverse-prompt activate evidence
reverse-prompt disable
# 从容器可访问的 UTF-8 文本导入用户预设
reverse-prompt import custom /workspace/my-prompt.txt
reverse-prompt activate custom
# 高级选项：仅替换 Reverse Persona，不修改别的 Prompt sections
reverse-prompt import specialist /workspace/specialist.txt --replace-persona
reverse-prompt remove custom  # 须先禁用或切换当前预设
```

用户状态位于 `$DSH_HOME/reverse-engineering/prompt-manager/state.json`，用户预设位于其 `presets/*.json`，由命令行原子写入，0600 权限。每次创建提示词会读取新配置；配置损坏、上游 Reverse Persona 锚点变化或模式不匹配时保持原文并记录去重警告，不阻断会话。

`preview` 只展示**变更分块的离线模拟预览**，并非完整真实会话 Prompt；不包含实际插件上下文与工具定义。工具的执行权限、审批和沙箱不会因提示词改变而扩大。禁止将不可信样本内容直接导入受信提示词，分析样本应始终作为数据处理。单个预设的文本最大约 12 KiB。


### Prompt Manager 增强：真实组装检查与分块级编辑

新增子命令（只适用于新版 Reverse 镜像）：

\`\`\`bash
docker exec dsh-reverse reverse-prompt inspect       # 最近一次真实组装的分块名、大小、哈希
docker exec dsh-reverse reverse-prompt doctor        # 配置、注入状态和兼容性诊断
docker exec dsh-reverse reverse-prompt capture-next  # 5 分钟内显式采集下一次 Reverse 组装
# 发送一次 Reverse Agent 消息后：
docker exec dsh-reverse reverse-prompt capture-show
docker exec dsh-reverse reverse-prompt preview-live evidence
docker exec dsh-reverse reverse-prompt capture-clear # 删除原始采集文本

docker cp analysis-guide.txt dsh-reverse:/workspace/analysis-guide.txt
docker exec dsh-reverse reverse-prompt section-set custom-guidance reverse:user-analysis /workspace/analysis-guide.txt
docker exec dsh-reverse reverse-prompt section-list custom-guidance
docker exec dsh-reverse reverse-prompt activate custom-guidance
docker exec dsh-reverse reverse-prompt history custom-guidance
docker exec dsh-reverse reverse-prompt rollback custom-guidance REVISION.json
\`\`\`

分块规则仅可增加 reverse:user-* 指令块（锚点为 Reverse Persona 或同一预设先前新增的分块），以及仅替换 Reverse Persona；拒绝覆盖 DSH 身份、工具协议、Plan 审批或其他 Agent 分块。每次保存已有用户分块预设会生成历史版本，最多保留 8 个版本，可回滚。旧版 append、replace-persona 格式仍兼容。

默认只记录真实组装时分块名称、大小和 SHA-256，不持久记录完整 System Prompt。完整原始 Section 文本仅在明确执行 capture-next 后采集一次，5 分钟内有效，采集上限 512 KiB；不会记录用户消息、变量值或工具 schema。采集文件位于私有 Reverse DSH_HOME 内且权限为 0600，直到 capture-clear 才删除。采集文本可能包含敏感系统指令，请勿公开。

注意：这是运行时实际观察到的 System Prompt Sections，在 DSH 最终渲染插值之前；不代表完整最终模型请求。当前为本地 CLI 配置和检查，尚未开发 Web 可视化编辑器。


### 原生 Web 可视化 Prompt Manager

Reverse 镜像通过 DSH Client Modules 向「设置 → 逆向提示词」注册 React 设置分区，不替换 DOM、不嵌入 iframe、不依赖 HMR。该界面提供预设列表、启用/恢复默认、用户预设创建与编辑、限定范围内的分块 JSON 规则、历史回滚、真实组装元数据检查和显式单次采集。数据处理仍使用同一套 `core.mjs` 与 `inspect.mjs`，与 `reverse-prompt` CLI 保持一致。

Host 接口使用已登录 Web Client 的 `/api` RPC、仅允许 loopback 权限级别的拦截，不额外暴露公开管理路由。默认只显示 section 元信息；完整正文需要明确采集并展开，随时可以删除。页面采用 DSH 主题变量；只针对 Reverse Agent，Standard 和其他会话不受影响。

**注意**：此功能必须在 PR 合并并发布新版 `:reverse` 镜像后才出现在 Web 设置页。上游 Web Client 插件加载能力可能随 DSH 版本变化，须以真实容器 UI 验证为准。
