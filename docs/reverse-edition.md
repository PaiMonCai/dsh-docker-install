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
