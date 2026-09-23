# DSH Docker — Deploy DSH. Do Reproducible Research.

本项目最初解决的是一个很简单的问题：**把 DeepSeek Harness（`dsh`）稳定地装进 Docker，并让它容易安装、更新、持久化和管理。**

随着实际使用，项目增加了一个可选方向：**Research Edition**。它不是另一个独立科研平台，而是在 DSH Docker 基础上增加“可复现研究”能力，让一次研究从数据、代码、运行、结果到论文都能被追踪和检查。

> **一句话定位：DSH Docker 是 DSH 的 Docker 发行与管理项目；Research Edition 是它的可选科研工作层。**

DeepSeek Harness（`dsh`）官方未提供 Docker 部署，本项目基于官方 npm 包
[`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness) 构建自定义镜像，
只调用 DeepSeek API，不跑本地模型。镜像内置 Chromium 浏览器（Playwright 管理），
供 agent 的浏览器类工具/插件使用。

## 这个项目到底是做什么的？

整个项目只需要理解成三层：

```text
DSH Docker
│
├── Standard
│   └── 安装 / 更新 / 持久化 / Web UI / Docker 运维
│
└── Research
    │
    ├── Core
    │   └── 通用可复现研究
    │
    └── Economics
        └── 经济学 / 计量经济学工具
```

### 1. Standard：项目的根

Standard 负责把 DSH 可靠地运行起来：

```text
服务器
  ↓
dshd install
  ↓
Docker
  ↓
DSH
```

它负责安装、启动、停止、更新、工作区映射、数据持久化、备份、诊断和卸载。  
如果你只是想使用 DSH，**到这一层就够了**。

### 2. Research：让科研过程可追踪、可复现

Research Edition 只解决一个核心问题：

> **这张表、这个回归结果、这篇论文，到底是由哪份数据、哪段代码、哪次运行生成的？**

它把研究过程组织成：

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

内部的 Dataset Catalog、Lineage、Pipeline DAG、Run Manifest、Result Registry、
Research Check、Stable JSON API 和 Dashboard 都只是为了服务这条链路。

### 3. Economics：Research 上的经济学工具包

Economics Pack 不改变 Research 的基本结构，只增加经济学常用能力，例如：

```text
OLS / Fixed Effects / IV
DiD / Event Study
Panel data
Clustered standard errors
Economic data tools
```

因此它们的关系始终是：

```text
DSH
 ↓
Research
 ↓
Economics
```

## 这个项目不是什么

本项目目前**不打算**变成：

- 自动替你完成论文的“科研机器人”；
- 覆盖所有统计方法的超大型计量软件；
- 替代 R / Stata / Python 的新编程语言；
- 需要第二套数据库才能运行的科研 SaaS；
- DSH Core 的 fork。

Research Edition 的原则仍然是：

```text
Files / manifests      = source of truth
CLI / JSON API         = stable protocol
Dashboard              = replaceable UI
```

删除 Dashboard 后项目仍然可以工作；删除缓存后仍可以从文件恢复；Research 层也不会修改 DSH Core。

## 普通用户真正需要记住的工作流

从 Research 0.9.0-rc.2 开始，普通用户的主要入口是 **DSH Agent**，不是 `research-*` 命令。0.9.0-rc.3 进一步把 Adapter 做成可配置兼容层，可适配自定义 DSH profile 与非固定后端安装路径。

```text
你
 ↓ 自然语言
DSH Agent
 ↓ native Research tools
Research Adapter
 ↓
Research Engine / CLI / manifests
```

三个入口的角色固定为：

```text
DSH Agent     → 做研究
Dashboard     → 看研究
research-*    → 后台协议 / CI / 调试 / 恢复
```

典型 Economics 使用方式：

```bash
dshd edition research
dshd research-pack economics
dshd shell

# 一次性 CLI Agent
dsh headless "在 /workspace 下创建一个 economics 研究项目 thesis，题目是数字基础设施与企业生产率。先定义研究问题和识别策略，不要直接估计。"
```

也可以直接使用 DSH Web UI，对 Agent 说：

```text
我把数据放到了 thesis/data/raw/firms.csv。
请检查研究设计和数据结构，先告诉我适不适合做 DiD，不要直接跑模型。
```

Agent 会调用内置的 `research_project / research_data / research_pipeline /`
`research_results / economics_did / economics_model` 工具。你不需要手工拼接
`research-econ-did --outcome ... --cohort ...` 这类底层参数。

需要排障、自动化或 CI 时，`research-*` CLI 仍完整保留。

## V2 之后的开发原则

V2.0 已进入 Release Candidate 阶段。接下来不再优先横向增加 R、Zotero、Agent、
更多计量模型等功能，而是先用真实研究项目反复验证现有工作流：

```text
真实研究
   ↓
发现 friction / blocker
   ↓
简化、修复、删除不必要复杂度
   ↓
再决定下一项功能
```

也就是说，**现在这个项目更需要被使用，而不是继续变大。**

项目提供三层镜像：

| 层级 | 镜像标签 | 用途 |
|---|---|---|
| Standard | `:latest` / `:<dsh版本>` | 通用 DSH Agent / 开发环境 |
| Research Core | `:research` / `:research-<research版本>` | 一般科研、文献、数据、可复现分析与论文 |
| Research Economics | `:research-economics` / `:research-economics-<research版本>` | 经济学、计量经济学、DiD / Event Study |

Research Edition 当前版本见 `research/VERSION`；当前为 **0.9.0-rc.3**。

```
.
├── Dockerfile                  # node:24-bookworm-slim + dsh + pnpm + Chromium
├── docker/
│   ├── entrypoint.sh           # 入口：web/headless/sdk/acp/dsh/plugin/bash 分发
│   ├── dsh-bind.patch.yml      # 关键：让容器内 GUI 监听 0.0.0.0 的官方 patch 层
│   ├── patch-remote-settings.js # 构建期启用远程 Settings
│   └── cn-mirror.sh            # 构建期国内网络自动检测
├── docker-compose.yml / .env.example
├── install.sh                  # 轻量 bootstrap：下载并启动 dshd
├── dshd                        # 交互式安装 + Docker 运维 / Edition 管理 CLI
├── research/
│   ├── Dockerfile              # Research Core + Economics Pack 多阶段镜像
│   ├── VERSION                 # Research Edition 版本
│   ├── bin/                    # 通用科研命令
│   ├── packs/economics/        # 经济学依赖、数据/回归/DiD 工具
│   └── templates/              # General / Economics 项目模板
└── .github/workflows/          # Standard / Research 构建与上游版本更新检测
```

## 快速开始

### 0. 一键安装（推荐）

一条命令进入交互式安装：

```bash
curl -fsSL https://raw.githubusercontent.com/PaiMonCai/dsh-docker-install/main/install.sh | bash
```

`install.sh` 现在只负责引导下载 `dshd`。真正的安装器会依次完成：

- 检测 Linux 发行版、Docker 命令和 Docker daemon；
- 未安装 Docker 时询问是否自动安装；
- 检测 GitHub Raw、GHCR、Docker Hub 以及网络区域特征；
- **首次安装强制明确填写 Docker 容器名和 Web UI 宿主机端口**（不再直接回车使用默认值）；
- 交互配置监听地址、工作区、持久化存储、Trusted Hosts，并选择 DeepSeek 官方 API 或自定义 Base URL，再配置 API Key；
- 拉取镜像失败时按候选源自动回退，并允许输入自定义镜像；
- 创建持久化目录和工作区；新安装默认使用 `/opt/dsh/data -> /root/.dsh` 与 `/opt/dsh/workspace -> /workspace`（非 root 为 `~/dsh/...`），同时保留 named volume 兼容模式；
- 询问是否开启 **Docker 项目管理模式**；开启后 DSH 可通过宿主机 Docker Socket 构建、部署和测试 Docker 应用；
- 将管理器安装为 `/usr/local/bin/dshd`，以后直接输入 `dshd` 管理。

安装完成后：

```bash
dshd
```

会打开交互式运维菜单。也可以直接使用子命令：

```bash
dshd status          # 状态 / 健康检查
dshd start           # 启动
dshd stop            # 停止
dshd restart         # 重启
dshd logs            # 实时日志
dshd update          # 拉取镜像并重建
dshd config          # 交互修改完整配置
dshd api             # DeepSeek API / Base URL 配置菜单
dshd api show        # 查看当前 API 模式
dshd api official    # 切换到 DeepSeek 官方 API
dshd api custom https://api.example.com
dshd hosts           # 快捷管理 Trusted Hosts
dshd hosts show      # 查看 Trusted Hosts
dshd hosts add dsh.example.com
dshd hosts remove dsh.example.com
dshd hosts set dsh.example.com,other.example.com:3080
dshd hosts clear
dshd docker          # Docker 项目管理权限菜单
dshd docker on       # 允许 DSH 管理宿主机 Docker
dshd docker off      # 关闭宿主机 Docker 权限
dshd docker status   # 检查 Docker Socket / Compose
dshd storage show         # 查看 /root/.dsh 的宿主机存储
dshd storage bind /opt/dsh/data     # 采用已有宿主机数据目录
dshd storage migrate /opt/dsh/data  # 从旧 named volume 自动迁移
dshd edition show    # 查看 Standard / Research Edition
dshd edition research # 切换到 Research Core
dshd edition standard # 切换回 Standard
dshd research-pack show      # 查看 Research Pack
dshd research-pack economics # 启用 Economics Pack
dshd research-pack none      # 回到 Research Core
dshd dashboard start my-study # 启动 Research Dashboard sidecar
dshd dashboard status         # 查看 Dashboard 状态
dshd dashboard stop           # 停止 Dashboard
dshd env             # 查看 Node/Python/Go/Docker 等开发环境版本
dshd env show        # 查看自定义容器环境变量（敏感值隐藏）
dshd env set NAME VALUE # 添加或更新容器环境变量
dshd env remove NAME # 删除容器环境变量
dshd env edit        # 编辑独立的 container.env
dshd env path        # 显示环境变量文件路径
dshd token           # 显示首次访问 token URL
dshd shell           # 进入容器
dshd backup          # 备份 dsh 数据卷
dshd restore         # 恢复备份
dshd doctor          # Docker / 网络 / 容器诊断
dshd recreate        # 按当前配置重建
dshd self-update     # 立即检查并更新 dshd 脚本自身
dshd uninstall       # 交互卸载
```

### dshd 自动更新

`dshd` 每次运行都会先检查脚本自身有没有新版本（仅 `help` / `version` 除外），
发现新版就自动替换当前脚本，并用新脚本继续执行你原本要执行的命令 ——
不用再重新跑一遍 `install.sh`。

- 更新源与 `install.sh` 一致：优先 GitHub Raw，失败时自动回退 jsDelivr；
- 下载结果先校验（非空、含 shebang、`bash -n` 语法通过）才允许覆盖，
  校验不通过直接放弃，绝不破坏当前可用版本；
- 网络不通时静默降级到本地版本，并在 5 分钟内不再重试；
- 脚本装在 `/usr/local/bin/dshd` 时，普通用户自更新需要 sudo 权限；
  权限不足会提示手动执行 `sudo dshd self-update`；
- 通过 `curl ... | bash` 管道方式执行时不做自更新（本身就是最新下载）。

```bash
dshd self-update     # 立即检查并更新（忽略节流）
```

关闭自动更新：

```bash
export DSHD_NO_SELF_UPDATE=1
```

自定义更新源（例如内网镜像）：

```bash
export DSHD_UPDATE_URL=https://example.com/dshd
```

配置默认保存在 `/etc/dshd/config.env`（非 root 用户保存在
`~/.config/dshd/config.env`），文件权限为 600。默认仍只映射
`127.0.0.1:3080`；如果选择 `0.0.0.0`，安装器会提示不要直接暴露公网，
建议前置 Nginx/Caddy + HTTPS。

首次安装时会直接询问 `DSH_TRUSTED_HOSTS`。安装完成后如果新增域名或修改反代，
无需重新走完整配置，直接运行 `dshd hosts` 即可快捷增删。修改后管理器会询问是否
立即重建容器，使新的 Trusted Hosts 马上生效。

如果配置了 Trusted Hosts，安装完成后的 Token 地址和 `dshd token` 会优先使用第一个
Trusted Host 生成公网访问地址（未显式带协议时默认按 HTTPS），同时安装完成页保留
`127.0.0.1:<端口>` 的本地回退地址。例如 `dsh.example.com` 会显示为
`https://dsh.example.com/?token=...`。

### 持久化目录

从 dshd 0.8.0 开始，新安装默认使用可直接查看的宿主机 bind mount：

```text
宿主机 /opt/dsh/data       -> 容器 /root/.dsh
宿主机 /opt/dsh/workspace  -> 容器 /workspace
```

其中：

- `/opt/dsh/data` 保存 sessions、credentials、profiles、插件和 DSH 内部状态；
- `/opt/dsh/workspace` 保存代码、项目、Research Project 和需要直接管理的文件；
- 非 root 安装默认使用 `~/dsh/data` 与 `~/dsh/workspace`；
- 历史安装如果仍使用 `dsh-home` named volume，不会被静默切换，继续保持兼容。

查看当前存储：

```bash
dshd storage show
```

旧安装自动迁移：

```bash
dshd storage migrate /opt/dsh/data
```

迁移时会先停止容器，复制 named volume 内容，再切换到 bind mount；旧 volume 不会自动删除，可作为回退。

如果已经手工把 `dsh-home` 内容复制到了 `/opt/dsh/data`，直接采用现有目录：

```bash
dshd storage bind /opt/dsh/data
```

切回已有 named volume：

```bash
dshd storage volume dsh-home
```

`dshd backup`、`dshd restore` 和 `dshd uninstall` 会根据当前 `DSH_STORAGE_MODE=bind|volume` 自动选择正确的数据源。

### Research Dashboard

Research Edition 0.8.2 起提供只读 Dashboard。推荐通过 `dshd` 启动独立 sidecar，不修改主 DSH 容器：

```bash
# /opt/dsh/workspace/my-study 是 Research Project
dshd dashboard start my-study

dshd dashboard status
dshd dashboard logs
dshd dashboard stop
```

Dashboard sidecar 使用当前 Research / Research Economics 镜像，并把宿主机工作区只读挂载：

```text
/opt/dsh/workspace  ->  /workspace:ro
```

默认宿主机端口：

```text
127.0.0.1:8765 -> Dashboard:8765
```

端口可以修改：

```bash
dshd dashboard port 9876
```

如果 DSH 部署在远程服务器，推荐从本地电脑建立 SSH 隧道：

```bash
ssh -L 8765:127.0.0.1:8765 root@your-server
```

然后本地浏览器打开：

```text
http://127.0.0.1:8765/
```

也可以由服务器上的 Nginx / OpenResty 反代 `127.0.0.1:8765`，并由反代层提供 HTTPS 与身份认证。

Dashboard Preview 本身不提供登录认证，也不会默认监听公网地址。页面只通过 Stable JSON API v1 读取 Project / Check / Data / Pipeline / Result 状态，不提供任意 shell、模型运行或数据修改接口。

### 自定义容器环境变量

需要向 DSH 容器传入代理、第三方工具或其他自定义环境变量时，使用：

```bash
dshd env set HTTP_PROXY http://proxy.example.com:7890
dshd env set HTTPS_PROXY http://proxy.example.com:7890
dshd env show
```

变量默认保存在 `/etc/dshd/container.env`；非 root 用户保存在
`~/.config/dshd/container.env`。文件权限为 `600`，重建容器时由
`docker run --env-file` 自动加载。名称包含 `KEY`、`TOKEN`、`SECRET`、
`PASSWORD`、`PASSWD` 或 `CREDENTIAL` 的变量在 `show` 输出中会隐藏值。

修改后，交互终端会询问是否立即重建；非交互调用需要执行：

```bash
dshd recreate
```

也可以直接编辑完整文件：

```bash
dshd env edit
```

删除变量：

```bash
dshd env remove HTTP_PROXY
```

`/etc/dshd/config.env` 仍只保存 dshd 管理配置，不会整体传入容器，避免意外泄露管理器内部配置。

### 容器资源与运行时默认值

针对内置 Chromium、Landlock 沙箱与长期运行场景，`dshd` 默认采用：

- `DSH_SHM_SIZE=1g`：避免 Docker 默认 64M `/dev/shm` 导致 Chromium/Playwright 随机 `Target closed` / SIGBUS；
- `DSH_TIMEZONE=Asia/Shanghai`：容器日志和命令默认使用中国标准时间；
- `DSH_NPM_CACHE=/tmp/npm-cache`：避免 Landlock 下默认 `/root/.npm` 不可写导致 `npm install` 失败；
- `DSH_MEMORY_LIMIT` / `DSH_MEMORY_SWAP` 默认留空，不强制限制；小内存宿主机可在 `dshd config` 中设置，例如 `1536m` / `2g`。其中 memory-swap 是 **RAM + swap 总上限**。

这些值由 `/etc/dshd/config.env`（非 root 用户为 `~/.config/dshd/config.env`）管理，修改后重建容器生效。
`dshd status` 会显示配置值，`dshd doctor` 会核对实际 `/dev/shm`、时区、npm cache、宿主资源余量与未固定的 Git 依赖。

### DeepSeek API / Base URL 配置

首次安装时会选择 API 接入方式：

1. **DeepSeek 官方 API**：默认选项，不设置 `DEEPSEEK_BASE_URL`；
2. **自定义 Base URL**：填写以 `http://` 或 `https://` 开头的兼容地址。

两种模式都可以配置 `DEEPSEEK_API_KEY`。安装后可随时运行：

```bash
dshd api
```

快捷切换，也可以使用：

```bash
dshd api show
dshd api official
dshd api custom https://api.example.com
```

API 配置保存在 dshd 配置文件中，权限为 600。状态页只显示 API Key 是否已配置，不输出密钥内容。
修改 Base URL 或 API Key 后，需要重建容器才能让新的环境变量生效，`dshd` 会直接询问是否立即重建。

### 1. 手动构建

```bash
docker build -t dsh:latest .
# 或指定 dsh 版本
docker build --build-arg DSH_VERSION=0.1.7-alpha.2 -t dsh:latest .
```

### 2. 运行

```bash
docker run -d --name dsh \
  --shm-size 1g \
  -p 127.0.0.1:3080:3080 \
  -e TZ=Asia/Shanghai \
  -e NPM_CONFIG_CACHE=/tmp/npm-cache \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -v dsh-home:/root/.dsh \
  -v "$PWD:/workspace" \
  dsh:latest
```

或复制 `.env.example` 为 `.env` 后 `docker compose up -d`。

### 3. 访问 Web UI（重要：带 token）

```bash
docker logs dsh | grep 'dsh web:'
# dsh web: http://0.0.0.0:3080/?token=xxxxxxxx
```

把 host 换成 `127.0.0.1` 后在浏览器打开。不带 token 访问一律 401；带 token 首次访问
返回 302/303 并种下 30 天签名 cookie，之后同一会话不用再带。

## 远程 Settings

官方 Web UI 会把非 loopback 浏览器会话的 Settings 持久化模式降为内存模式。
本镜像在构建时对 Web 前端发布产物应用 Remote Settings patch，使通过域名或反向代理访问时
也可以正常使用“设置 → 模型”等 Settings 页面。

推荐保持以下访问方式：

```text
浏览器 HTTPS
  ↓
Nginx / Caddy / OpenResty
  ↓
127.0.0.1:<DSH_PORT>
  ↓
DSH
```

同时配置：

- 首次访问 Token；
- `DSH_TRUSTED_HOSTS`（只写 `host` 或 `host:port`，不要带协议和路径）；
- HTTPS 反向代理；
- 不直接把 DSH Web UI 端口暴露到公网。

### 反向代理必须保留原始 Host

DSH 会在所有 `/api` 请求进入业务处理前校验 `Host`、`Origin` 和
`Sec-Fetch-Site`。因此反向代理必须把浏览器访问时的原始 authority 传给上游；
`X-Forwarded-Host` 不能替代真正的 `Host`。如果代理把 `Host` 改成
`127.0.0.1`，而浏览器发送 `Origin: https://dsh.example.com`，两者不一致，
包括 `settings/describe` 在内的 `/api` 请求都会返回 HTTP 403，即使域名已经加入
`DSH_TRUSTED_HOSTS`。

Nginx / OpenResty（包括宝塔反向代理）推荐配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;

    # 关键：保留浏览器请求中的域名和可选端口。
    proxy_set_header Host $http_host;
    proxy_set_header Origin $http_origin;

    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 600s;
}
```

不要使用下面这种配置：

```nginx
proxy_set_header Host 127.0.0.1;
proxy_set_header Host $proxy_host;
```

每增加一个访问域名，还需要更新 Trusted Hosts 并重建容器：

```bash
dshd hosts add dsh.example.com
dshd recreate
```

排查时可以在 Docker 宿主机直接模拟请求（把示例域名换成实际域名）：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3080/api/settings/describe \
  -H 'Host: dsh.example.com' \
  -H 'Origin: https://dsh.example.com' \
  -H 'Sec-Fetch-Site: same-origin'
```

未携带浏览器 Cookie 时，返回 `401` 表示 Host/Origin 信任校验已经通过；返回 `403`
表示 Trusted Hosts 尚未应用，或反向代理传递的 Host/Origin 不匹配。修改反向代理头后
只需重载代理；修改 `DSH_TRUSTED_HOSTS` 才需要重建 DSH 容器。

补丁只修改 `@deepseek-ai/dsh-client-ui-settings` 客户端插件中的 Settings 持久化判断，
不改变其他 loopback 安全判断。构建时如果找不到对应表达式，镜像构建会直接失败，避免
上游版本变化后补丁静默失效。

## Plugin Hub 反向代理 POST 修复

社区插件 `dsh-plugin`（Plugin Hub）目前对安装、卸载、保存设置、清日志等 POST 操作有独立的
Origin 防护：上游除了要求 `Origin.host === Host`，还把 hostname 写死为
`localhost / 127.0.0.1 / ::1`。因此即使 DSH 主 Web UI 已通过
`DSH_TRUSTED_HOSTS` 信任反代域名，Plugin Hub 仍可能返回：

```text
403 {"error":"untrusted origin"}
```

本镜像包含 `docker/patch-plugin-hub-origin.js`。由于 Plugin Hub 安装在持久卷的
`$DSH_HOME/profiles/<profile>/node_modules/dsh-plugin`，而不是镜像全局 npm 目录，
entrypoint 会在每次启动 DSH 前对已安装 profile 做**幂等运行时 patch**：

- loopback（localhost / 127.0.0.1 / ::1）保持原上游行为；
- 反代域名必须满足 `Origin.host === Host`；
- 且该 Host 必须出现在 `DSH_TRUSTED_HOSTS` 中；
- 同时把客户端对 bare `untrusted origin` 的错误分类修正：只有明确的
  `ERR_PNPM_UNTRUSTED_ORIGIN` 才按 pnpm 供应链策略处理。

因此反向代理仍必须保留浏览器原始 Host/Origin，不能把它们伪造成 127.0.0.1。
Plugin Hub 升级覆盖 node_modules 后，下一次 `dshd restart` / `dshd recreate`
会再次自动应用 patch；若上游结构变化导致无法匹配，entrypoint 会明确告警，
`dshd doctor` 也会提示 patch 未生效，而不会静默把问题误报成 pnpm 故障。

## 关键设计

1. **`--host 0.0.0.0` 是禁区，用 patch 层绕过**：CLI 会明确拒绝
   `dsh web --host 0.0.0.0`（怕把 RCE 暴露到网络），但 webserver 的 schema 本身
   接受 `0.0.0.0`。所以镜像用 `dsh web --patch /opt/dsh/dsh-bind.patch.yml` 这个
   **官方叠加层**改 bind host（见 `docker/dsh-bind.patch.yml`），用户显式传
   `--host` 仍然优先。
2. **Host 围栏**：回环 Host 永远受信任；域名/局域网访问要用 `DSH_TRUSTED_HOSTS`
   声明对外 authority（逗号分隔），否则 `/api` 返回 401/403。
3. **默认 root 运行**：bind mount 权限最省事，文件级限制交给 dsh 自己的沙箱。
   要降权加 `--user 1000:1000` 并保证挂载目录可写。
4. **历史 Workspace 自动自愈**：当前标准持久工作区是 `/workspace`。如果持久卷中仍有
   以旧 `cwd=/root/dsh` 创建的会话（对应 `$DSH_HOME/sessions/--root-dsh--`），而容器
   recreate 后 `/root/dsh` 已随旧 overlay 消失，入口脚本会在 DSH 启动前自动创建
   `/root/dsh -> /workspace` 软链接。它不会改写不可变的 SessionHeader，也不会让新会话继续
   使用旧路径；`dshd doctor` 会显示修复状态。

## 文件沙箱

dsh 的文件/命令沙箱后端候选链是 bubblewrap → 内核 Landlock：

- 默认 `docker run`（seccomp+AppArmor）下 bwrap 拿不到 userns 会失败，候选链自动
  落到 **Landlock**，开箱可用（实测 `/workspace` 可写、`/etc` 被拒）。
- 要让 bwrap 生效需同时给
  `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add SYS_ADMIN`
  （只加 seccomp 不够）。
- 内核两者都不可用时，设 `DSH_PERMISSION_MODE=danger-full-access` 临时关闭沙箱。

## 内置开发环境

镜像现在定位为通用 Agent 开发环境，而不只是 Node.js 容器。预装：

| 环境 | 内容 |
|---|---|
| JavaScript / TypeScript | Node.js 24、npm、pnpm 11.7.0（与 dsh 官方 packageManager 一致） |
| Python | Python 3、pip、venv、uv |
| Go | Go 1.27.1（amd64 / arm64） |
| Docker 工具 | Docker CLI、Buildx、Docker Compose v2 |
| 编译工具 | build-essential（gcc / g++ / make 等） |
| 常用 CLI | git、curl、wget、jq、zip、unzip、openssh-client、procps、less |
| 浏览器 | Playwright + Chromium |

可直接运行：

```bash
dshd env
```

查看当前运行容器中的实际版本。

## 自定义模型推理等级

镜像内置一个很薄的 DSH Web 扩展，用于补齐官方「自定义模型 API」目前没有暴露的
`reasoningEfforts` 编辑能力。它不 fork DSH，也不维护第二套模型配置：

```text
DSH 官方 Models 页面
        ↓ official settings.models.provider-card slot
DSH Docker Reasoning Editor
        ↓ remote.settings.mutate()
llm-pi-ai / providers.<route>.models[*].reasoningEfforts
```

只对 `llm-pi-ai` 管理的**手工声明自定义 Provider**显示。每个模型可以选择：

- **未声明**：删除该模型的 `reasoningEfforts`，继续采用 DSH catalog / 端点默认行为；
- **非推理模型**：写入 `reasoningEfforts: false`；
- **自定义等级**：使用类似 `dsh-better-reasoning-effort` 的离散滑轨，
  点击 `off / minimal / low / medium / high / xhigh / max` 节点声明模型支持的档位。
  高级映射默认折叠，仅在网关需要不同拼写时展开，例如 `max → xhigh`。

例如把 DSH 的 `max` 映射为网关的 `xhigh`，最终仍写回 DSH 官方配置：

```yaml
models:
  - id: my-reasoner
    reasoningEfforts:
      off:
      high: high
      max: xhigh
```

滑轨只负责声明该自定义模型可用的 `reasoningEfforts`，不会改变当前已运行 Session 的
显式推理等级选择。DSH 当前 `llm-pi-ai` 的模型配置 schema 不接受模型级
`defaultReasoningEffort`，因此内置编辑器不会写入这个字段。编辑器也不会自动猜测模型能力、
不会探测网关、不会修改 API Key / Base URL / 输入模态 / compat 配置。保存使用 DSH Settings 的 revision fence；发生并发修改时会重读并重试一次，
且始终以当前 user-layer `models` 数组为基线保留其他字段。

> `off:` 留空表示不发送 `reasoning_effort`。如果某个 DeepSeek 兼容端点默认就会思考，
> 需要显式关闭时仍应按 DSH 官方约定设置 `compat.thinkingFormat: deepseek`。

该扩展作为镜像内本地 bundle 随版本发布，容器启动 Web profile 时仅通过现有
`dsh plugin` 生命周期幂等接入，不直接改写 `profiles/web/package.json`。默认开启；
设置 `DSH_REASONING_EDITOR=false` 后会通过同一个 Plugin Manager 从 Web profile 移除。
使用 `dshd` 管理部署时可执行 `dshd env set DSH_REASONING_EDITOR false`，随后按提示重建容器。

## Docker 项目管理模式

DSH 容器内只安装 **Docker 客户端**，不运行第二套 dockerd。需要让 DSH 部署和测试
Docker 项目时，可执行：

```bash
dshd docker on
```

开启后 `dshd` 会把检测到的宿主机 Docker Socket 挂载为
`/var/run/docker.sock`，并添加 `host.docker.internal:host-gateway`。此时 DSH 可以
直接执行 `docker build`、`docker compose up -d`、查看日志和测试映射到宿主机的项目端口。

为避免 Compose bind mount 的路径错位，`dshd` 管理的 workspace 会在宿主机和 DSH
容器内使用**相同绝对路径**。

> **安全提醒：** 能访问宿主机 Docker Socket 基本等价于拥有宿主机 root 级控制能力，
> 因此此模式默认关闭，并且开启时需要明确确认。即使 DSH 对普通子进程剥离了 API Key/Token，
> 开启 Docker Socket 后仍可通过 `docker inspect` 读取容器的 `Config.Env`，所以环境变量过滤不能作为秘密隔离边界。

关闭：

```bash
dshd docker off
```

## 内置浏览器

镜像内通过 Playwright 安装了 Chromium（含全部系统依赖），路径
`/usr/local/bin/chromium`（同时暴露在 `CHROME_BIN` / `CHROMIUM_PATH` 环境变量），
浏览器二进制存放在 `/ms-playwright`。浏览器类工具/插件（如 Playwright MCP）
直接指向该路径即可；容器内启动 Chromium 通常需要 `--no-sandbox`。

## 国内服务器

构建时**自动检测网络环境**（默认 `IN_CHINA=auto`）：连不通 Google 且能连通百度
即判定为国内网络，自动切换下载通道——

| 内容 | 境外源 | 国内自动切换为 |
|---|---|---|
| apt 软件包 | deb.debian.org | mirrors.aliyun.com |
| npm 包 | registry.npmjs.org | registry.npmmirror.com（仅构建时检测为国内网络时写入镜像） |
| Playwright 浏览器 | playwright CDN | npmmirror.com/mirrors/playwright |

GitHub Actions 在境外构建时通常保留官方 `registry.npmjs.org`；这是预期行为。运行时网络若访问 npmjs 已足够快无需切换，需要时可通过 `dshd env set NPM_CONFIG_REGISTRY https://registry.npmmirror.com` 覆盖。

手动控制：

```bash
# 强制按国内处理 / 强制按境外处理
docker build --build-arg IN_CHINA=yes -t dsh:latest .
docker build --build-arg IN_CHINA=no  -t dsh:latest .

# 有真实 HTTP 代理时直接传代理
docker build --build-arg HTTPS_PROXY=http://127.0.0.1:7890 -t dsh:latest .
```

## Research Edition（一般科研版）

Research Edition 不 fork DSH 核心，而是在 Standard 镜像之上增加 **Research Engine + DSH-native Research Adapter**。

正常使用链路是：

```text
User
 ↓
DSH Agent
 ↓
DSH-native Research Adapter
 ↓
Research CLI / Stable JSON API
 ↓
Research Engine
 ↓
files + manifests
```

其中 `research-*` 是稳定后端接口，不是要求普通用户记忆的主要 UI。

Research Adapter 默认注入 `web,headless`，但兼容层并不写死 profile：

```bash
# 增加自定义 Agent profile
DSH_RESEARCH_ADAPTER_PROFILES=web,headless,tui dsh tui

# 所有 profile 都允许注入
DSH_RESEARCH_ADAPTER_PROFILES='*' dsh my-profile

# 临时绕过 Adapter
DSH_RESEARCH_ADAPTER_DISABLE=1 dsh web
```

后端命令也支持自定义搜索路径：

```text
DSH_RESEARCH_BIN_DIR
DSH_RESEARCH_BIN_PATH
/usr/local/bin
PATH
```

因此源码开发、派生镜像和组织内部目录布局都可以复用同一 Adapter。

Research Edition 的镜像层级仍然是：

```text
Standard
  └─ Research Core
       └─ Economics Research Pack
```

对应镜像：

| Edition / Pack | 镜像 |
|---|---|
| Standard | `ghcr.io/paimoncai/dsh-docker-install:latest` |
| Research Core | `ghcr.io/paimoncai/dsh-docker-install:research` |
| Research Economics | `ghcr.io/paimoncai/dsh-docker-install:research-economics` |

Research Core 额外提供 NumPy / pandas / Polars / SciPy / statsmodels /
scikit-learn / SymPy / PyArrow / DuckDB、JupyterLab、Jupytext、Quarto、Pandoc、
XeLaTeX、中文 TeX 字体、Poppler、qpdf、Graphviz 等科研与论文工具。

安装时可以直接选择 Research；已有安装可切换：

```bash
dshd edition research
dshd edition show
dshd env
```

切回 Standard：

```bash
dshd edition standard
```

### 一般科研工作流

推荐直接让 DSH Agent 创建和管理项目：

```bash
dshd shell
dsh headless "创建一个名为 my-study 的通用 Research Project，标题为研究标题。先检查项目状态并告诉我下一步，不要替我编造数据或结果。"
```

Web UI 中也可以直接用自然语言持续推进。

底层等价命令仍然存在：

```bash
research-init my-study "研究标题"
cd my-study
```

但它们主要用于调试、CI 和自动化。

默认项目结构围绕：

```text
literature → data/raw → data/processed → analysis → results → paper → archive
```

常用命令：

```bash
research-literature add 10.1257/aer.20181234
research-literature add arXiv:2401.01234
research-literature add ./paper.pdf
research-literature review
research-literature verify

research-run --name baseline -- python src/analysis.py
quarto render paper/paper.qmd
research-archive
```

`research-literature` 会维护 `references.bib`、`sources.jsonl`、结构化阅读笔记、
Evidence Matrix 和 PDF / 文本 SHA256；`research-run` 会记录 Git 状态、运行命令、
环境、输入/输出 hash 与日志；`research-archive` 默认不打包 `data/raw`。

### Economics Research Pack

启用经济学环境：

```bash
dshd research-pack economics
dshd research-pack show
```

创建经济学项目：

```bash
research-init --template economics thesis "经济学本科毕业论文"
cd thesis
```

Economics Pack 额外包含：

```text
pyfixest==0.60.0
linearmodels
arch
wbgapi
pandas-datareader
```

并要求在 `research.yaml` 中显式记录 population、unit of observation、outcome、
estimand、identification strategy、fixed effects、standard errors / clustering、
robustness、heterogeneity、mechanism，以及 DiD 项目的 treatment timing /
comparison group / reference period / anticipation assumptions。

#### Python / R / Stata 如何选择

DSH Economics 当前采用 **Python-first**。原因不是 Python 在每一种计量方法上都最强，
而是它可以贯穿数据获取、清洗、计量、机器学习、AI、自动化和科研工程整条链路：

```text
API / 爬虫 / Excel / 数据库
          ↓
pandas / Polars / DuckDB
          ↓
pyfixest / linearmodels / statsmodels
          ↓
scikit-learn / LLM / NLP
          ↓
Quarto
          ↓
论文与可复现归档
```

三种工具的定位可以简单理解为：

| 维度 | Python | R | Stata |
|---|---|---|---|
| 核心定位 | 通用编程 + 数据科学 + 科研工程 | 统计 / 科研语言 | 专业统计计量软件 |
| 数据清洗 | 很强 | 很强 | 好 |
| 传统计量 | 很强 | 很强 | 很强 |
| DiD / Event Study | 已较强 | 生态非常成熟 | 很成熟 |
| 固定效应 / IV / Panel | 很强 | 很强 | 很强 |
| 统计方法前沿 | 强 | 通常很快 | 相对依赖命令生态 |
| 可视化 | matplotlib / plotly | ggplot2 很强 | 可用 |
| 机器学习 / AI | 很强 | 可用 | 不适合作为主力 |
| API / 爬虫 / 自动化 | 很强 | 可用 | 较弱 |
| 大数据 / 数据工程 | 很强 | 强 | 较弱 |
| Web / Agent / 软件开发 | 很强 | 可用 | 不是主要用途 |
| 开源 | 是 | 是 | 否 |

可以把三者理解为：

```text
Stata  → “我要完成一个标准计量分析”
R      → “我要做统计 / 经济学研究”
Python → “我要用代码完成整个研究问题”
```

因此当前推荐的使用路线是：

```text
Python
  ├─ 数据获取
  ├─ 数据清洗
  ├─ 计量分析
  ├─ AI / ML
  ├─ 自动化
  └─ Quarto 论文
       ↓
R（后续加入）
  └─ 高级统计 / 部分前沿计量 / fixest / did 等生态

Stata
  └─ 阅读与复现既有经济学代码、课程和导师工作流
```

对长期研究环境而言，Python 作为主语言最容易与 DSH Agent、数据工程和自动化集成。
R 更适合作为后续补充，而不是替代现有 Python 工作流；两者未来可以共享同一个
`data/processed/`、`results/` 和 `paper.qmd`。Stata 则更适合作为兼容和复现工具，
不作为 DSH Research 的核心运行依赖。

当前 Economics Pack 的标准数据处理语言仍是 Python。建议将清洗和变量构造逻辑写入
`src/*.py`，保持 `data/raw/` 不可变，并把分析数据输出到 `data/processed/`。

#### 经济数据

```bash
research-econ-data worldbank NY.GDP.MKTP.CD \
  --economy CHN,USA \
  --start 2000 \
  --end 2025

research-econ-data fred FEDFUNDS

research-econ-data list
research-econ-data verify
```

外部数据会保存为不可变时间戳快照，并记录来源、查询参数、检索时间和 SHA256。
FRED 的检索时间不会被冒充为 ALFRED historical vintage。

#### 回归 → 表格 → 图 → 论文

```bash
research-run --name baseline-regression -- \
  research-econ-model feols \
  --name baseline \
  --title "基准回归" \
  --data data/processed/analysis.csv \
  --formula "y ~ treatment + x1 | entity_id + year" \
  --vcov cluster \
  --cluster entity_id \
  --focus treatment
```

会生成 model manifest、CSV / Markdown 回归表、系数图，并自动更新：

```text
paper/generated/economics-results.qmd
```

Quarto 可直接引用：

```text
@tbl-econ-baseline
@fig-econ-baseline
```

多个模型可以生成 manifest-backed 并列表：

```bash
research-econ-model compare \
  --name main \
  --title "主回归结果" \
  --model baseline \
  --model controls \
  --term treatment
```

对应引用：

```text
@tbl-econ-compare-main
```

#### DiD / Event Study

先检查 panel、cohort 和 treatment timing：

```bash
research-econ-did check \
  --name policy-check \
  --data data/processed/panel.csv \
  --outcome y \
  --id firm_id \
  --time year \
  --cohort first_treated_year \
  --treatment treated \
  --never-treated 0
```

正式动态估计：

```bash
research-run --name did-saturated -- \
  research-econ-did estimate \
  --name did-saturated \
  --title "政策动态效应" \
  --data data/processed/panel.csv \
  --outcome y \
  --id firm_id \
  --time year \
  --cohort first_treated_year \
  --treatment treated \
  --never-treated 0 \
  --cluster firm_id \
  --estimator saturated \
  --mode dynamic
```

当前支持：

| Estimator | 用途 |
|---|---|
| `twfe` | 传统双向固定效应；staggered adoption 时作为 baseline |
| `did2s` | Gardner DID2S |
| `saturated` | cohort-interacted / Sun-Abraham-style event study |
| `lpdid` | Local-projection DiD |

输出目录：

```text
results/did/<name>/
├── did.json
├── diagnostics.json
├── cohorts.csv
├── estimates.csv
├── panel.png
└── event-study.png
```

同时自动更新：

```text
paper/generated/did-results.qmd
```

Quarto 交叉引用：

```text
@tbl-did-<name>
@fig-did-<name>-panel
@fig-did-<name>-event
```

`research-econ-did check` 会检查重复 unit-time、cohort 一致性、处理是否出现
`1 → 0`、显式 treatment 是否与 cohort 隐含处理路径一致等问题。
对于 staggered adoption，工具会提示不要只依赖 TWFE；pre-treatment 的逐点 p 值只作为
诊断，不被视为“平行趋势成立/不成立”的单独证明。

最终归档前：

```bash
research-literature verify
research-econ-data verify
research-econ-model verify
research-econ-did verify
research-archive
```

完整科研版说明见 `research/README.md`。

## Research V2 路线图

V1 已经打通 Literature → Data → Run → Model / DiD → Paper → Archive。
V2 不以“继续安装更多科研包”为核心，而是把这些对象组织成完整的 Research Project lifecycle。

经过对当前仓库结构和 DSH 官方扩展机制的验证，以下方向可以在不 fork DSH 核心的前提下继续开发：

| 阶段 | 重点 | 核心产物 |
|---|---|---|
| V2.0 | Project State + Pipeline DAG + Data Catalog + Research Check + Dashboard | 项目状态、stale detection、数据 lineage、DSH Research UI plugin |
| V2.1 | R runtime | R + renv，与 Python 共用 processed/results/paper |
| V2.2 | Zotero + Evidence Graph | 文献增量同步、claim ↔ evidence 显式关系 |
| V2.3 | Advanced Economics | RDD、Synthetic Control、现代 DiD、DML、Causal ML、sensitivity |
| V2.4 | Research Agents + Release | Planner/Reviewer 工作流、一键 replication package |

V2 的关键架构原则：

```text
CLI / manifests = source of truth
           ↑
     Research Engine
           ↑
  DSH Research UI plugin
```

Research Dashboard 可以利用 DSH 官方 plugin / Web Client 扩展点实现，但 DSH 仍处于
developer preview，因此 UI 必须保持可替换；项目不能依赖某个 Web UI API 才能恢复。

R 会作为可选执行引擎加入 Economics Pack，使用 `renv.lock` 管理项目依赖；Python 仍是
数据获取、清洗、自动化、AI/ML 和默认计量工作的主语言。Python 与 R 共用
`data/processed/`、`results/`、`paper/` 和 `research-run` 的可复现协议。

Zotero 集成计划基于 Web API v3，先做只读、幂等的 collection → BibTeX / sources /
Evidence Matrix 同步，再考虑双向写入。API key/OAuth 不进入科研项目文件。

详细设计、可行性结论和分阶段目标见 [`research/README.md`](research/README.md)。

## 其他运行模式

同一个镜像入口支持多种 profile：

```bash
docker run --rm dsh:latest headless "跑一下测试"   # 一次性 headless 任务
docker run --rm dsh:latest dsh --dump-config      # 原样透传给 dsh CLI
docker run --rm -v dsh-home:/root/.dsh dsh:latest \
  plugin --profile web add <name>                 # 安装到持久化的 Web profile
docker run --rm -it dsh:latest bash               # 进容器排查
```

镜像把 pnpm 固定为当前 DSH 构建所使用的 `11.7.0`。如果已有数据卷中的
`profiles/*/node_modules/.modules.yaml` 是由其他 pnpm 大版本生成的，需先用当前 pnpm
重新执行一次 `pnpm install --force --no-frozen-lockfile`；仅重建镜像不会改写持久卷中的
旧依赖树。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | DeepSeek API 密钥；dshd 官方/自定义模式共用 |
| `DEEPSEEK_BASE_URL` | — | 可选；留空使用 DeepSeek 官方默认地址，自定义兼容 API 时填写 |
| `DSH_HOME` | `/root/.dsh` | profile / 会话 / 凭据目录（持久卷） |
| `DSH_PORT` | `3080` | 监听端口（命令行 `--port` 优先） |
| `DSH_BIND_HOST` | `0.0.0.0` | bind host（patch 层读取；改成 127.0.0.1 仅容器内可访问） |
| `DSH_TRUSTED_HOSTS` | — | 逗号分隔的受信任 authority，域名/反代访问必填 |
| `DSH_REASONING_EDITOR` | `true` | 是否启用内置自定义模型 `reasoningEfforts` 编辑器；`false` 时通过 DSH Plugin Manager 移除 |
| `DSH_PERMISSION_MODE` | — | `danger-full-access` 可临时关闭文件沙箱 |
| `DSH_DOCKER_ACCESS` | `false` | dshd 是否把宿主机 Docker Socket 挂入 DSH |
| `DSH_SHM_SIZE` | `1g` | 容器 `/dev/shm` 大小；为 Chromium/Playwright 预留足够共享内存 |
| `DSH_TIMEZONE` | `Asia/Shanghai` | dshd 注入容器的时区；镜像默认同样为中国标准时间 |
| `DSH_NPM_CACHE` | `/tmp/npm-cache` | npm cache 路径，默认位于 Landlock 可写目录 |
| `DSH_MEMORY_LIMIT` | — | 可选容器内存上限，例如 `1536m` / `2g` |
| `DSH_MEMORY_SWAP` | — | 可选 RAM+swap 总上限；仅在设置 `DSH_MEMORY_LIMIT` 时使用 |
| `DSH_DOCKER_SOCKET` | 自动检测 | 宿主机 Docker Socket 路径 |
| `DSHD_NO_SELF_UPDATE` | — | 设为 `1` 关闭 dshd 运行时的脚本自更新 |
| `DSHD_UPDATE_URL` | — | 自定义 dshd 自更新源（默认 GitHub Raw → jsDelivr） |
| `DSHD_CONTAINER_ENV_FILE` | 自动选择 | 自定义容器环境变量文件路径 |
| `DSHD_SELF_UPDATE_RETRY_DELAY` | `300` | 自更新失败后的退避秒数，`0` 表示不节流 |
| `CHROME_BIN` / `CHROMIUM_PATH` | `/usr/local/bin/chromium` | 内置 Chromium 路径 |
| `TZ` | `Asia/Shanghai` | 容器运行时实际时区（dshd 由 `DSH_TIMEZONE` 注入） |
| `NPM_CONFIG_CACHE` | `/tmp/npm-cache` | npm 实际 cache 路径（dshd 由 `DSH_NPM_CACHE` 注入） |

## 自动构建与更新（GitHub Actions）

- **`.github/workflows/build.yml`** — 构建并推送镜像到 GHCR
  （`ghcr.io/<owner>/<repo>`），打 `:latest` 和 `:<dsh版本>` 双标签，
  amd64 + arm64 双架构。触发方式：镜像相关文件变更、手动触发、被更新检查调用。
- **`.github/workflows/build-research.yml`** — 构建 Research Core 与 Economics Pack。
  PR 仅做 amd64 验证；合并到 `main` 后发布 amd64 + arm64：
  `:research`、`:research-<research版本>`、`:research-economics`、
  `:research-economics-<research版本>`。
- **`.github/workflows/check-update.yml`** — 每天检查 npm registry 上
  `@deepseek-ai/dsh` 的最新版本，发现新版本时自动修改
  `Dockerfile` / `docker-compose.yml` / `README.md` 中的版本号并提交，
  然后调用 build 工作流构建新镜像。也可在 Actions 页面手动触发。

使用前确认仓库 **Settings → Actions → General → Workflow permissions** 选择
"Read and write permissions"（更新检查需要提交代码的权限）。GHCR 首次推送后
在 Packages 页面把包设为 Public 即可免登录拉取。

注意：用 `GITHUB_TOKEN` 提交的 push 不会触发其他工作流（GitHub 防递归限制），
所以更新后的构建是通过 `workflow_call` 显式调用的，不依赖 push 事件。

## 说明

- 构建参数 `DSH_VERSION` 锁定 npm 包版本（当前版本见 Dockerfile 顶部；
  developer preview 可能有破坏性变更），check-update 工作流会自动维护
- 镜像包含 Chromium、Python、Go、Docker CLI 和编译工具，因此体积会明显大于最小化 Node 镜像
- 本方案的基础运行层（patch 绑定、入口分发、沙箱策略）已在
  Docker 26.1.4 / 内核 6.8 上实测通过
