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


### Electron/JS 静态初检

新增 `reverse-js-triage /workspace/project` 命令：递归扫描工作区内 `.js/.cjs/.mjs/.ts/.tsx/.jsx/.json` 文件（排除 node_modules、构建输出、符号链接），识别 Electron 主进程、IPC、网络、动态代码执行等静态关键词；不运行 JS，也不尝试加载或执行 ASAR。上限 250 文件、累计 8 MiB、单文件 256 KiB。可选 `--output /workspace/reverse-analysis/js-report.json` 输出 JSON 报告。该命令是启发式初检，不保证完整解析代码或证明运行行为。


## 第三批启动：跨版本静态报告对比

`reverse-diff /workspace/v1/functions.json /workspace/v2/functions.json` 比较两份 `dsh-reverse-ghidra/v2` 静态报告，给出新增、删除、修改的函数和调用边。对比基于地址，重新链接后的偏移变化可能产生大量假阳性，结果需人工确认。两个输入限定工作区、各不超过 8 MiB，不运行任何程序。

动态调试接口、网络协议会话抓取与调度队列尚未进入本次实现；它们必须有独立的授权确认、隔离边界、超时/资源限制和恢复策略。第四批可视化逆向工作台待任务、证据 API 约定和数据持久性验证后推进。


## 第四批启动：工作区证据索引

新增 `reverse-workspace index /workspace/a/report.json /workspace/b/functions.json --output /workspace/reverse-index.json` 以生成统一 `dsh-reverse-workspace/v1` 证据索引，记录已完成静态报告的相对路径、schema、文件大小及 SHA-256。`reverse-workspace verify /workspace/reverse-index.json` 可检查文件是否被修改或丢失。支持初检、Ghidra v2、Electron/JS、diff 等四类已知报告；最多 100 个、单文件不超过 8 MiB、总量不超过 32 MiB，跳过重复路径、拒绝外部路径和符号链接。只读报告本体，不执行代码；索引文件不会默认覆盖已有记录。

这是第四批证据平台的第一层数据协议，**不是完整工作台**。独立 UI 函数浏览、证据检索、任务恢复还需要基于该协议继续开发，并且不得把索引文件当作结论真实性证明。



## 第三批任务队列：持久化、可恢复、显式执行

新增 `reverse-task` 管理逆向静态分析任务。支持五类固定任务：`triage`、`js-triage`、`ghidra`、`diff`、`verify`。不接受任意命令、不经 Shell 执行、不运行输入样本；参数限定工作区路径，工作状态存入 `/workspace/.reverse-tasks/*.json`，重启后保留。

```bash
reverse-task enqueue triage /workspace/sample.elf
reverse-task enqueue ghidra /workspace/sample.elf
reverse-task enqueue js-triage /workspace/my-electron-app
reverse-task list
reverse-task run-once   # 显式处理一个待办任务，带超时
reverse-task show TASK_ID
reverse-task recover    # 中断的 running 任务变为 interrupted，不自动重跑
reverse-task retry TASK_ID  # 仅显式重试 failed/interrupted，最多 3 次
```

任务采用独占工作者锁，避免多次 `run-once` 并发处理；每条任务保留退出状态、截断的 stdout/stderr 和时间戳。运行中断后不会自动重试或执行外部命令；`recover` 只转换状态。当前没有后台守护进程或定时调度，适合先验收持久性、安全边界和任务状态模型，后续再接到 Web 工作台与调度服务。重试可能导致分析输出与旧产物冲突，需检查结果后再操作。


## Web Workbench 第一版（只读）

逆向提示词设置区域新增「逆向分析工作台」模块，复用已有 Web Client 和 Loopback RPC。现在支持查看最近最多 100 项离线任务的状态、尝试次数与退出码，按工作区相对路径打开已知 schema 的静态 JSON 报告，并查看 Ghidra 函数列表、签名及有界伪代码。现阶段不提供在线执行、重试、任意文件读取或动态调试按钮。报告大小限制为 8 MiB，拒绝绝对路径、路径穿越和符号链接。只有登录的 DSH Web 客户端才能访问内建 RPC。Web 插件模块由镜像自身提供，Standard 不受影响。


### Web Workbench 调用图和证据关联

在 Ghidra v2 报告页面展示有界 SVG 调用图（最多 24 节点、48 条边），节点可点击和键盘选中，联动查看选中函数的签名、伪代码、调用与被调用关系以及函数入口点引用。函数名称和地址支持过滤。图形连线仅表示导出的静态调用边，不等价于完整运行时控制流；间接调用和未导出函数可能缺失。Web RPC 对引用记录仍有长度/数量限制，并只返回导出函数范围内的调用边和入口引用。


### 工作台证据索引导航（校验后打开）

在 Web Workbench 输入工作区相对路径（如 `reverse-index.json`），选择「读取并校验证据索引」。前端按索引展示报告路径、schema 及完整性校验结果；后端使用 SHA-256、报告大小与 schema 检查索引指向的报告。只有校验通过的条目可通过「打开证据」跳转到对应函数/证据报告。路径穿越、符号链接和超过 8 MiB 的报告仍会拒绝。此校验只能确认文件与索引创建时一致，不保证逆向分析结论正确，也不代表已完成真实浏览器验收。


### 独立设置入口

Web Workbench 不再嵌在「逆向提示词」页面内，使用同一原生 DSH Client Module 单独注册「设置 → 逆向工作台」页签。提示词管理和分析浏览相互独立，但继续共用 DSH 已登录客户端的只读 loopback RPC，不需要额外网页服务器或端口。


## Reverse Workbench 2.0 第一阶段：项目目录原型

在「设置 → 逆向工作台」增加项目创建和项目列表。项目只包含名称、可选说明、创建时间和 UUID，保存在挂载工作区的 `.reverse-projects/<UUID>.json`，不会随容器镜像更新而消失（前提：工作区挂载未被替换）。项目文件以私有权限写入，数量上限 100，名称最多 80 字符。

本次项目目录是后续样本、任务、函数和证据关联的基础；目前 **尚不关联项目下的任务与样本**，项目选择不会更改现有分析任务的作用域。浏览器原生设置入口仍需运行时交互验收，CI 提供脚本语法、数据持久化和拒绝非法参数等自动测试。


### Workbench 2.0 项目资源关联

可以将工作区内的样本文件、已有分析任务 UUID 和已知格式的静态证据 JSON 报告关联到所选项目。项目资源保存在 `.reverse-projects/<UUID>.links.json`，最多 120 项，关联样本及证据时记录 SHA-256；读取项目时重新校验文件存在性及哈希，任务通过已有只读任务详情接口确认。不会复制样本、修改已有任务、自动执行程序或使任务变成项目专属；当前归属为索引关系，不具有访问权限隔离的含义。


### 项目内创建任务与同步报告

Workbench 的项目详情现可创建五种允许的静态任务（`triage`、`js-triage`、`ghidra`、`diff`、`verify`），复用 `/workspace/.reverse-tasks` 的现有任务格式，并立即关联任务 UUID。输入限定工作区，拒绝任意命令、路径逃逸和符号链接。**Web 只添加 `queued` 任务，执行仍需要显式调用 `reverse-task run-once`**。可在任务完成后点击「同步已完成任务的证据」：仅从成功的 Ghidra 与二进制初检任务的固定报告位置读取并验证已知格式 JSON，再关联证据；其余工具暂不自动推断输出。没有后台任务执行器、自动重试或未经授权的动态调试。


### 受控 Web 单任务执行（默认关闭）

设置容器环境变量 `DSH_REVERSE_WEB_EXECUTION=1` 后，逆向工作台可要求输入 `EXECUTE_ONE_PROJECT_TASK` 才允许触发关联项目中已排队的任务。后端调用固定的 `reverse-task run-once --expected-id UUID`，在队列锁持有期间确认 UUID 正好是全局队首；否则拒绝执行。这不是任意命令执行接口。无配置时只允许排队与只读查看。子进程为无 Shell 调用，设定超时，输入路径仍由现有逆向任务 CLI 重新检查。运行过程中不要关闭部署的访问权限；仍需实际浏览器验证与操作审计。


### 稳定性修复：任务超时进程树清理

Web 一次性执行器启动独立进程组。超时先向整个进程组发送 SIGTERM，5 秒后升级为 SIGKILL，避免只杀死队列主进程却留下分析子进程；队列工作者本身也为执行工具创建独立进程组并在超时后清理。若任务被信号中断，原有任务状态恢复规则仍要求操作者显式使用 `reverse-task recover` 和 `retry`。这不是完整容器端到端沙箱隔离；上线前仍需真实长时任务与浏览器操作验收。
