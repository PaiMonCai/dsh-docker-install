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


### 并发写入和数据完整性（稳定性专项）

项目资源关联写入使用原子创建的项目级 `.links.lock` 目录作为跨进程互斥锁。同一项目并发请求会明确返回“正在更新”，而非读旧记录后覆盖新内容。写入使用私有临时文件、`fsync` 和原子重命名，索引若被符号链接替换会拒绝读取。意外断电/进程崩溃可能留下锁目录，必须在确认没有活跃写入者后人工处理；暂不自动清理陈旧锁。项目 *创建* 与队列提交的跨文件事务、TOCTOU 和 fsync 目录耐久性仍需后续审计。


### 项目任务创建的两阶段提交与恢复

Web 创建任务时先写入 `staging`（队列工作者不会执行该状态），完成项目关联后才通过原子重命名切换至 `queued`。若第二步失败，删除尚未排队的任务记录；若进程在项目关联后崩溃，工作台提供「恢复中断的任务登记」，仅校验项目内有记录的暂存任务及原始输入，再切换为可排队状态。恢复**不会执行任何分析任务**。

该措施改善项目任务与关联索引的崩溃一致性，但并非跨文件数据库事务；损坏的孤儿暂存记录需人工审计，仍需更全面的容器断电、并发写入及恢复测试。


### 恢复操作审计与孤儿任务盘点

`workbenchOrphanTasks` 提供只读盘点，列出最多 300 个任务文件中的未关联 `staging` 任务、已关联暂存任务和无效记录，不执行、删除或自动重试。手动项目恢复操作将 UUID、时间和成功/跳过的任务写入私有、限长的 `.reverse-tasks/recovery-audit.jsonl`。审计日志的容量上限为 1 MiB；达到上限会拒绝追加，需要管理员归档。当前仍需要容器级中断注入和真实浏览器验收。


### DSH 核心 API 404 回归检测（新建会话与目录选择器）

针对浏览器新建会话时报 `/api/session/create HTTP 404`，以及工作目录选择器报 `/api/directoryPicker/list HTTP 404`，Reverse CI 新增运行中容器的核心 API 路由检测：以未登录 POST 分别检查两条路径及 `workspaceFiles/list`，期望到达 Web Connection 的身份验证入口（HTTP 401），而不是被错误地路由为 404/405。该检查属于**后端路由存在性诊断**，不能证明已登录的实际创建/列目录操作成功，也不能判断用户域名上的 Nginx/Caddy 转发是否正确。部署时需比对直接容器端口与反代域名下同一请求的状态码，避免错误地通过重建项目数据处理网关故障。


## Standard Web 插件动态继承与发布门禁

Reverse 使用 Standard 镜像作为 `FROM`，内置 Web 插件的权威清单是 Standard 镜像中
`/opt/dsh/plugins/*/package.json` 的 `dsh.client.platform=web` 声明及其
`/usr/local/bin/dsh-entrypoint` 启动补丁；不再在 Reverse CI 中维护固定插件名称列表。

- PR 若修改 Standard Dockerfile、`docker/plugins/**` 或启动/插件加载逻辑，
  Reverse CI 先从当前 PR 构建候选 Standard 镜像，再构建 Reverse；否则可复用已发布的 Standard。
- CI 对比 Standard 和 Reverse 内置插件目录、文件 SHA-256、插件身份与补丁声明；
  并在隔离的 Reverse 容器里将 Standard 声明的插件开关全部打开，核对实际 Web
  启动参数及登录后的客户端模块图。
- 发布到 GHCR 前执行相同的 amd64 审计与 Chromium 浏览器冒烟测试；审核失败不推送新的
  Reverse 多架构标签。来自 Standard 自动发布的构建仍必须传入不可变 digest。
- 本地 `docker compose -f docker-compose.reverse.yml up -d --build` 会主动拉取更新的
  Standard 基础镜像，防止缓存的 `:latest` 长期不更新。

**边界**：这里的“继承”仅涵盖镜像内自带的插件和相关文件。
Standard 的 `/root/.dsh` 持久卷与 Reverse 独立；用户额外安装在 Standard Web
Profile 的第三方插件、凭证或选项不会自动迁移。新插件若采用新的非标准加载机制，
需要扩展此校验协议，不能把绿色的文件检查解释成所有 UI 功能都已通过交互验收。


## Universal Reverse Core（第一批：跨平台逆向方法论）

新增 `universal-reverse-core` Skill，其 `references/` 按需加载目标路由、四道 Gate、证据验证与故障索引。它属于逆向 Agent 的统一决策方法，不是 APK 专项工具，也不更改 REA、Ghidra、JADX、GDB 等现有工具权限。实际静态/动态工具仍按目标类型选用，并需验证设备和运行时能力。

在 Reverse 镜像中只读检查工具存在性：

```bash
reverse-doctor --json
reverse-doctor --route android-static
reverse-doctor --route native-static
```

输出 `dsh-reverse-capabilities/v1` 报告，单项能力状态为 `available`、`partial`、`blocked`。这是**存在性检查**，不是设备可用性或整个逆向流程成功的保证。特别是 `runtime-frida` 即使主机组件齐全，也必须额外验证授权目标及兼容的设备端环境。

Skill 加载器现在将整个包内 Skill 目录（含嵌套引用）原子安装到 `$DSH_HOME/reverse-engineering/skills/`。为保护用户修改，**已存在的同名 Skill 目录会全部保留，不自动合并或覆盖**。如果用户曾自行创建同名 Skill，需要自行核对新镜像中 `/opt/dsh-reverse/skills/universal-reverse-core/` 后手动迁移；无需清理持久卷。

四道 Gate：G1 授权与目标交付；G2 能力真实可用范围；G3 行为归属层；G4 原始基线与对照实验。静态任务不因无法动态执行而伪报通过；发生反证时停止同类盲目重试。此批只加入方法论、能力诊断和文档/测试，不引入样本动态执行、跨平台修改工具或新的 Web 工作台写操作。

通用设计参考 [newliver666/apk-reverse](https://github.com/newliver666/apk-reverse)（MIT）；本仓库独立整理跨平台路由与实现。


## 第二批：Reverse Case 持久化证据与实验引擎

第二批新增独立命令 `reverse-case`，仅写入 Reverse 的 `/workspace/.reverse-cases`；不会修改分析目标、启动未知程序或更改现有任务执行白名单。每个 case 保存目标 SHA-256、G1–G4 状态、证据（关联文件的大小和哈希）、可反驳假设、实验设计/结果、明确被证伪的结论及任务状态快照。JSON schema 为 `dsh-reverse-case/v1`，原子写入、串行锁、资源数与大小限制，适合会话中断后的复盘。

```bash
reverse-case create /workspace/sample.elf --goal "解释启动失败" --deliverable "可复现的静态报告"
reverse-case list
reverse-case show <case-uuid>
# 以下动作把观察写入持久化文件；证据文件应为已脱敏的分析结果
reverse-case evidence <case-uuid> --file /workspace/reverse-analysis/triage/report.json \
  --locator "function:0x1000" --observation "发现启动调用链" --grade observed --tool reverse-triage
reverse-case hypothesis <case-uuid> --statement "初始化例程决定启动结果" \
  --falsifier "同一输入的基线轨迹没有到达该例程"
reverse-case experiment <case-uuid> H001 --variable "初始化参数" \
  --control "相同二进制、环境与输入" --falsifier "两组结果没有预期差异"
reverse-case gate <case-uuid> G3 passed --note "已从静态调用关系定位负责层" --evidence E001
reverse-case verify <case-uuid>
```

与原队列对接时增加可选的 `--case-id`，旧调用保持兼容：

```bash
reverse-task enqueue triage /workspace/sample.elf --case-id <case-uuid>
# 任务执行仍由现有 allowlist worker 显式启动，无新增自动执行路径
reverse-case sync-task <case-uuid> <task-uuid>
```

`reverse-workspace index` 可以将 case JSON 连同其他报告纳入 SHA-256 清单，`verify` 会检查文件哈希、长度和 schema。更新 case 后旧快照校验失效是预期行为，需要重新创建清单，不能覆盖原始记录。

Workbench RPC 新增只读 `workbenchCases` / `workbenchCase`，返回关卡、数量、假设和实验状态的**脱敏摘要**，不展示任意证据正文、任务 stdout 或实验注释。可视化假设树留待第三批。

**边界**：`gate passed` 记录的是有证据关联的操作者声明，不能作为授权或设备隔离的唯一安全控制；工具运行成功只说明任务执行成功，绝不自动提升结论可信度。对静态检验，保留未做动态观察的限制，不伪造实验结果。


目录型项目也可创建案件（例如 `reverse-case create /workspace/electron-project --goal "还原 IPC 调用关系" --deliverable "调用图"`）。引擎最多扫描 2000 个文件、累计 256 MiB；目录指纹包含相对路径、大小和内容哈希，拒绝符号链接和特殊文件。超出上限时应选择更小、明确的分析范围，不会悄悄忽略文件。


> **升级兼容提醒**：镜像启动时不会覆盖持久卷中已有同名 Skill，所以此前安装的 `universal-reverse-core` 仍保留原文。Phase 2 的 `reverse-case` 使用说明同时写入镜像自有 Reverse Agent Persona 与本文档；如需同步完整最新 Skill，请先比对 `/opt/dsh-reverse/skills/universal-reverse-core/` 与用户目录后手动迁移，避免丢失自定义内容。


## 第三批：跨平台故障知识库与案件关系工作台

`reverse-knowledge` 提供内置跨平台只读故障索引（12 条）。每条列出观察信号、先查什么、竞争性解释、建议验证及局限，**不是任何当前样本的证明**。不会运行样本、触发网络访问或执行检索到的代码。

```bash
reverse-knowledge platforms
reverse-knowledge search "loader" --platform elf
reverse-knowledge search "ipc" --platform electron
reverse-knowledge show native-loader-failure
```

只有操作者可经 CLI 将已完成证据核验的经验明确提升为本地索引：案件至少有一条 `observed` 证据、G3/G4 已记录为通过，并且 `reverse-case verify` 哈希验证成功。它仍是一条**未经独立普遍验证**的个案参考。

```bash
reverse-knowledge promote <case-uuid> --platform elf \
  --title "启动时动态库缺失" \
  --signal "loader cannot find shared library" \
  --check "只读核对依赖和加载路径" \
  --lesson "先在一致环境中做对照检查"
```

本地结果保存在 `/workspace/.reverse-knowledge/case-<uuid>.json`，创建后不可覆盖。仅保存人工输入的简短说明、来源案件 UUID、目标 SHA-256 与关联证据 ID；不会复制原始日志。**填写之前必须人工脱敏**，切勿输入口令、令牌和个人数据。本地学习条目仍属于不可信输入，不得改变 Agent 权限。

「设置 → 逆向工作台」新增跨平台故障检索、案件关卡与假设—实验—证据关系视图，全部采用现有登录 RPC 和只读数据接口，不增加知识编辑/样本执行权限。Web 默认不显示案件原始观测正文及任务 stdout，完整内容通过本地 `reverse-case show` 审查。

旧版同名 Skill 仍由加载器保留；内置 Reverse Persona 同时提供 `reverse-knowledge` 路由入口提示，确保旧用户无需覆盖自定义 Skill。


## Reverse 架构收敛：项目、案件和统一任务队列

`Project` 是工作空间的归档入口；`Case` 是一个可持久化的调查问题；`Task` 负责白名单静态工具的执行；`Evidence` 负责文件哈希和观察记录。现在一个 Project 可以关联既有 Case（不复制 Case 数据或迁移现有 JSON），Web 中可以在新建任务时选定**已经关联的 Case**。关联目标不匹配时，任务会在入队前被拒绝。旧的项目、未关联案件以及独立 CLI 任务继续兼容。

```bash
# 1. 创建案件（输出 UUID）
reverse-case create /workspace/sample.elf --goal "解释初始化流程" --deliverable "调用链报告"
# 2. 在 Web → 逆向工作台 → 项目与任务，将 Case UUID 关联到项目。
# 3. 新建任务时选择对应 Case，任务数据持久保存 case_id。
# 4. CLI 仍可直接创建与案件关联的受控任务：
reverse-task enqueue triage /workspace/sample.elf --case-id <case-uuid>
```

CLI 与 Web **都由 `reverse-task` 维护任务状态**；Web 采用 `enqueue --stage` 创建暂存记录，关联项目成功后调用 `publish` 才可执行。关联失败调用 `discard`，中断后的 `staging` 不会由执行器自动运行，项目管理员可在 Web 中审查和显式恢复。`reverse-task run-once` 仍需授权主动调用；Web 执行默认关闭。所有操作继续使用同一个全局顺序队列及原白名单。

`reverse-task enqueue ...` 的普通 CLI 行为保持不变，`--stage`、`publish <task-id>` 与 `discard <task-id>` 是供受控关联过程使用的显式状态操作。Web 工作台按“项目与任务 / 案件关系 / 经验检索 / 证据与报告”切换视图，不再一次渲染所有卡片。系统保持文件存储、原 Agent/Skills 和原工具链，不增加数据库与服务端口。

项目中的 Case 关系由 `.reverse-projects/<project>.links.json` 记录 UUID 引用，而不是复制 Case JSON。Case 工作台会从同一 `.reverse-tasks` 任务队列中实时读取与 `case_id` 匹配的近期任务状态，因此 Web 任务状态更新不依赖额外的手工 `sync-task`；手工 `reverse-case sync-task` 仍可在审计账本里保留任务状态快照。证据是否支持结论仍要通过显式证据登记及验证，不能因为任务成功就自动把推测标记为已观察事实。


## 下一批架构收敛：前端源码模块化与执行边界可见

Reverse 原生 Web 客户端仍通过 `window.__ModuleLoader__` 交付**一个** `client.js`，不修改 DSH 插件加载协议。但项目源码现在分为 `reverse/prompt-manager/web/src/` 下的独立维护单元（基础组件、Prompt 设置、案件图、工作台及加载器入口），使用内置的无依赖生成脚本检查：

```bash
node reverse/prompt-manager/web/build-client.mjs       # 重新生成 client.js
node reverse/prompt-manager/web/build-client.mjs --check # CI 检查源码与产物一致
```

Web 任务执行策略统一在 `web/execution-policy.mjs`：默认拒绝，只有 `DSH_REVERSE_WEB_EXECUTION=1` 时才可能允许执行，同时要求严格的人工确认、受控的五种任务类型和现有队列任务关联/队首检查。工作台的项目页展示当前 Web 执行开关与允许类型，可通过仅只读 `workbenchExecutionPolicy` RPC 查询，不显示令牌等机密配置。

**权限边界务必区分**：此策略**仅覆盖 Reverse Web 任务执行入口**；Python CLI 的白名单由 `reverse-task` 自己执行；DSH Agent 可以通过 Bash / REA MCP 直接调用工具，这些权限由 Agent、容器、部署隔离和主机策略分别决定，并没有被该 Web 策略统一接管。本批没有更改 DSH Agent 内核权限、网络访问、设备附着策略或现有镜像默认暴露端口。
