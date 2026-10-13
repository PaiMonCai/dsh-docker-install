# DSH Docker

**Deploy DSH. Do reproducible research.**

**容器运行时：Ubuntu 24.04 LTS (Noble)**。Standard 镜像及继承它的 Research 镜像均采用 Ubuntu 24.04，保持 Node.js 24、Python 3.12、Go、Docker CLI、Chromium/Playwright 与内置 SearXNG。宿主机无需改装 Ubuntu，只需具备受支持的 Docker 运行环境。

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Docker 发行与运维项目。它不 fork DSH Core，而是把官方 npm 包稳定地封装成可安装、可更新、可持久化、可反代的容器，并在此基础上提供可选的 Research Edition。

版本来源保持单一：基础 DSH 版本见 [Dockerfile](Dockerfile) 的 `DSH_VERSION`，Research 引擎自身版本见 [research/VERSION](research/VERSION)（写入镜像并记录到每次运行，不参与镜像 tag）。研究镜像的发布 tag 跟随它实际包住的 DSH 版本。

## 你应该用哪个版本

| 版本 | 镜像标签 | 适合 |
|---|---|---|
| Standard | `:latest` / `:<dsh版本>` / `:alpha`·`:next` | 日常 DSH Agent、Web UI、开发环境 |
| Research Core | `:research` / `:research-<dsh版本>` / `:research-alpha` | 一般科研、文献、数据、可复现分析 |
| Research Economics | `:research-economics` / `:research-economics-<dsh版本>` / `:research-economics-alpha` | 经济学、计量、DiD / Event Study |

关系始终是：

```text
DSH Standard
   └─ Research Core
        └─ Economics Pack
```

## 快速开始

推荐直接运行安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/PaiMonCai/dsh-docker-install/main/install.sh | bash
```

安装完成后使用：

```bash
dshd
```

常用命令：

```bash
dshd status
dshd logs
dshd update
dshd restart
dshd token
dshd shell
dshd mounts show
dshd mounts add /opt/dsh/ssh /root/.ssh
dshd proxy setup
# 或查看现有配置
dshd proxy status
dshd doctor
```

切换 Research：

```bash
dshd edition research
dshd research-pack economics

# 回到 Standard
dshd edition standard
```

安装器与 `dshd` 菜单对每一步都做了错误隔离：某一步失败只会提示原因并**回到菜单**，
不会中途退出脚本；已填写的配置在拉取镜像之前就会落盘，网络恢复后继续即可。
菜单里 `Ctrl-C` 只取消当前操作，`0` / `Ctrl-D` 才退出。

完整安装、访问、反向代理、持久化和 API 配置见 [部署与访问](docs/deployment.md)，
交互行为细节见 [Runtime 与运维](docs/runtime.md#交互式菜单的错误边界)。

## 固定 Web 登录 Token

首次启动会自动生成高强度 Token 并保存在 DSH 的持久卷中，后续镜像更新、
容器重建或 Docker 重启不再改变 `?token=...` 首次登录链接。
支持 `dshd token status` 查询模式、`dshd token set` 自定义以及
`dshd token reset` 重新生成；自定义值使用隐藏式终端输入，不写入 Docker 环境参数。
旧版已登录浏览器的 Cookie 独立持久，重置 Token 并不会注销已有登录。
详细说明见 [部署文档](docs/deployment.md#固定-web-登录-token)。

## Web 会话管理插件

DSH 会话管理现由内置 `dsh-docker-session-manager` **Web 插件**提供，不再需要 `dshd sessions` CLI：

新版回收站使用更宽的响应式管理面板：支持按标题或会话 ID 搜索、按删除时间筛选与排序、批量选择和恢复。批量永久删除需要输入确认文字；每条操作仍通过原有安全 API 完成，部分失败会保留在回收站供重试。

- DSH 左侧边栏底部「回收站」可查看删除记录并恢复。
- 会话右侧 `···` 菜单仅提供「删除会话」；只有进入回收站后才能执行「永久删除」。
- 「删除会话」先通过 DSH 原生安全归档机制隐藏会话，同时保存回收站记录；原始会话文件仍在原处，恢复时立即取消归档。它不会停止 DSH 或改变项目工作区。
- 「永久删除」只接受回收站中的会话，按用户确认强制清理目标会话目录；即使仍存在活动 Agent / 写入所有者也不会因占用拒绝。相关任务可能被终止，删除后不可恢复；操作不重启 Docker。
- 所有会话管理界面默认中文；任何删除操作均不会删除 `/workspace` 文件。
- 浏览器需要刷新一次以加载新版插件；若需关闭，可设 `DSH_SESSION_MANAGER_WEB=false` 后重建容器。

旧版本（V1）已通过 CLI/重启方式移入 `.dshd-session-trash` 的记录不属于新版 Web 逻辑回收站，仍需先在安全备份中手动处理；升级不会自动清除旧回收数据。

> 强制删除会结束目标会话的活动任务，并可能使该会话仍持有的旧写入句柄报错；DSH 上游没有公开的完整会话卸载 API，因此这不是无副作用的操作。插件不会重启 Docker，也不会清理项目工作区文件。建议重要记录先备份后操作。

详见 [Runtime 与运维](docs/runtime.md)。

## 内置逆向工程 Agent（dsh-purge × REA）

Standard Docker 镜像已在**构建阶段**集成 REA 和固定版本的 [dsh-purge](https://github.com/ANRCM0/dsh-purge) 逆向模块：进入 DSH Web 直接选择「逆向工程」Agent，MCP 通过容器内预装的 `rea mcp` 连接；Icon Dock 提供「逆向工作台」查看项目、证据与报告。无需容器启动后安装第三方 MCP。

功能通过 `DSH_REVERSE_AGENT_ENABLED=true` 默认启用，设为 `false` 可以关闭预设与工作台；不会运行 dsh-purge 的全局提示词/破甲模块，也不会下载 Ghidra/IDA 等分析引擎。

详见 [Docker 内置逆向工程 Agent](docs/reverse-agent.md)。

## Standard 提供什么

Standard 镜像主要解决 DSH 的运行和管理问题：

- 官方 DSH npm 包的 Docker 化；
- Web / headless / sdk / acp 等 profile 入口；
- 持久化 `DSH_HOME`、工作区，并支持自定义目录挂载（如 `/root/.ssh`）；
- Trusted Hosts、Token URL 和反向代理适配；
- Remote Settings；
- Chromium / Playwright；
- Node / Python / Go / Docker CLI 开发环境；
- 可选宿主机 Docker Socket 管理；
- 国内网络构建镜像源适配；
- 可选 sing-box sidecar 国际网络出口，支持 HTTP / SOCKS、VLESS、Trojan、Hysteria2、Shadowsocks 分享链接、订阅刷新、节点测速与 URLTest 自动故障切换；
- `dshd` 安装、更新、备份、恢复和诊断。

详细运行时说明见 [Runtime 与运维](docs/runtime.md)。

## 自定义模型推理等级

镜像内置一个轻量 DSH Web 扩展，用于补齐自定义模型的 `reasoningEfforts` 编辑能力。

```text
Models 页面
   ↓
声明模型支持哪些 reasoningEfforts
   ↓
DSH 原版 Composer 读取并提供推理等级选择
```

Models 页仍通过 DSH 官方 Settings API 保存；Composer 保持 DSH 原生的“模型 / 推理等级”交互，不做 DOM 替换。

详细设计、兼容边界和 `max → xhigh` 等映射方式见 [自定义模型推理等级](docs/reasoning-editor.md)。

## Research Edition

Research Edition 不是第二套 DSH，也不是“自动写论文”的独立平台。它是在 Standard 镜像上增加可复现研究能力：

```text
Dataset
  ↓
Pipeline
  ↓
Run
  ↓
Result
  ↓
Artifact
  ↓
Paper
```

普通用户主要通过 DSH Agent 使用 Research 工具；底层 `research-*` CLI 继续作为稳定协议、CI 和调试入口。

Economics Pack 额外提供 Python-first 的计量工具，包括固定效应、IV、DiD、Event Study、经济数据获取和结果注册。

完整 Research Engine、Dashboard、Economics Pack、V2 架构与 RC Gate 见 [Research Edition](research/README.md)。

## 镜像

GHCR：

```text
ghcr.io/paimoncai/dsh-docker-install:latest
ghcr.io/paimoncai/dsh-docker-install:<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:alpha
ghcr.io/paimoncai/dsh-docker-install:next
ghcr.io/paimoncai/dsh-docker-install:research
ghcr.io/paimoncai/dsh-docker-install:research-<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:research-alpha
ghcr.io/paimoncai/dsh-docker-install:research-economics
ghcr.io/paimoncai/dsh-docker-install:research-economics-<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:research-economics-alpha
```

三类 tag 各有分工：

```text
:<dsh版本>            锁定到具体 DSH 版本
:latest              始终跟随最新一次构建（含 alpha / rc 预发布）
:alpha  :next        与上游 npm dist-tag 同名，跟随上游发布通道
```

自动更新链路不仅会重建 `:<dsh版本>` 与 `:latest`，还会把指向该版本的
npm dist-tag 通道名原样打到镜像上，于是

```text
docker pull <image>:alpha   ≈   npm i @deepseek-ai/dsh@alpha
```

查询上游失败或版本不对应任何通道时，只发布版本号与 `:latest`，不让构建失败。

Research 镜像用同样的三类含义，只是加上 edition 前缀（`:research` /
`:research-economics` 是浮动 tag，相当于研究镜像的 `:latest`），且版本 tag 跟随
**它实际包住的 DSH 版本**：`:research-<dsh版本>`、`:research-alpha`。
`research/VERSION` 只标识研究引擎自身版本，不参与镜像 tag。

基础镜像更新后，**Standard CI 会先独立完成并发布**，随后启动另一次 GitHub Actions 运行构建 Research；科研版失败不会影响已发布的基础版。该独立运行使用刚发布的**精确镜像 digest**、源码 commit、DSH 版本和通道快照，避免基于旧的 `:latest`。仅修改 Research 时可以单独构建；同一提交同时修改两者时，会等待基础版发布后再启动 Research。

构建、GHCR、镜像 tag 通道对齐与自动检测上游 DSH 更新的说明见 [镜像构建与自动更新](docs/ci.md)。

## 自部署网页搜索（可选）

内置 Search Router 使用 SearXNG 作为免费主搜索源，并提供用户授权的 Brave API 备用；保留官方 `web_search` / `web_fetch` 工具与现有插件系统，默认关闭，不改变已有安装。通过 `dshd search enable`、`dshd search test` 开启和测试。 开启后，Web 左侧边栏底部的「回收站」与「网络搜索」图标并排显示，均为纯图标、悬停显示中文提示。图标由独立的 **快捷入口管理插件** 统一渲染；进入 **插件 → 快捷入口管理** 可使用 5×2 可视化布局预览拖动排序、选择「快捷栏 / 更多 / 隐藏」和调整尺寸；快捷栏最多 9 个图标，第 10 格为「更多」，窄侧栏采用 2×2，未来插件也可接入。搜索未启用时只显示回收站；原搜索插件页入口仍保留。详见 [图标管理与接入规范](docs/icon-dock.md) 和 [内置插件接入规范](docs/builtin-plugin-contract.md)。内置的图标坞、会话回收站、网络搜索和推理等级编辑器通过镜像自身的 DSH 原生 `--patch` 层加载，**不依赖第三方插件安装器或 pnpm**。 另外，官方侧边栏的「插件」「自动化任务」等导航会由 Icon Dock **复用官方注册的原生图标组件**，并变成可自由排序的纯图标；可在设置里一键恢复原生文字导航。详见 [Web Search 使用与架构](docs/web-search.md)。

## 文档

详细说明已经从根 README 拆出：

- [文档索引](docs/README.md)
- [部署与访问](docs/deployment.md)
- [Runtime 与运维](docs/runtime.md)
- [国际网络出口 / sing-box](docs/proxy.md)
- [自定义模型推理等级](docs/reasoning-editor.md)
- [镜像构建与自动更新](docs/ci.md)
- [Research Edition](research/README.md)

## 安全边界

默认部署只应把 DSH Web 暴露给受控网络或 HTTPS 反向代理。启用宿主机 Docker Socket 后，容器基本拥有宿主机 root 级 Docker 控制能力，应只在明确需要时开启。

Research Dashboard 默认是只读工作流视图，不应直接裸露到公网。

更多安全和运行时说明见 [Runtime 与运维](docs/runtime.md)。

## 项目原则

这个仓库的边界保持简单：

```text
DSH Core             → 上游负责
Docker / dshd        → 本仓库负责
Research Engine      → 可选扩展
UI compatibility     → 尽量走官方扩展点
runtime state        → 始终由 DSH 自己拥有
```

不为了“方便”维护第二套 DSH 状态，不把 UI 适配描述成安全沙箱，也不让 Research 层反向接管 DSH Core。


### Web 文件管理插件 405

镜像已内置 DSH 第三方 RPC 通道路由修复。若文件管理等插件的私有 RPC
接口返回 HTTP 405，可执行 `dshd update` 更新镜像。修复和排查边界见
[Web 插件文件管理 HTTP 405 修复](docs/deployment.md#web-插件文件管理-http-405-修复)。
