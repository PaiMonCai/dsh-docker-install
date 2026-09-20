# DeepSeek Harness (dsh) 自定义 Docker 镜像

DeepSeek Harness（`dsh`）官方未提供 Docker 部署，本项目基于官方 npm 包
[`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness) 构建自定义镜像，
只调用 DeepSeek API，不跑本地模型。镜像内置 Chromium 浏览器（Playwright 管理），
供 agent 的浏览器类工具/插件使用。

```
.
├── Dockerfile                  # node:24-bookworm-slim + dsh + pnpm + Chromium
├── docker/
│   ├── entrypoint.sh           # 入口：web/headless/sdk/acp/dsh/plugin/bash 分发
│   ├── dsh-bind.patch.yml      # 关键：让容器内 GUI 监听 0.0.0.0 的官方 patch 层
│   └── cn-mirror.sh            # 构建期国内网络自动检测
├── docker-compose.yml / .env.example
├── install.sh                  # 轻量 bootstrap：下载并启动 dshd
├── dshd                        # 交互式安装 + Docker 运维 CLI
└── .github/workflows/          # 自动构建 + 上游版本更新检测
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
- 交互配置监听地址、工作区、数据卷、Trusted Hosts 和 DeepSeek API Key；
- 拉取镜像失败时按候选源自动回退，并允许输入自定义镜像；
- 创建持久卷和工作区，启动容器并等待 Web UI；
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
dshd env             # 查看 Node/Python/Go/Docker 等开发环境版本
dshd token           # 显示首次访问 token URL
dshd shell           # 进入容器
dshd backup          # 备份 dsh 数据卷
dshd restore         # 恢复备份
dshd doctor          # Docker / 网络 / 容器诊断
dshd recreate        # 按当前配置重建
dshd uninstall       # 交互卸载
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

### 1. 手动构建

```bash
docker build -t dsh:latest .
# 或指定 dsh 版本
docker build --build-arg DSH_VERSION=0.1.5-rc.2 -t dsh:latest .
```

### 2. 运行

```bash
docker run -d --name dsh \
  -p 127.0.0.1:3080:3080 \
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
| JavaScript / TypeScript | Node.js 24、npm、pnpm 10 |
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
> 因此此模式默认关闭，并且开启时需要明确确认。

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
| npm 包 | registry.npmjs.org | registry.npmmirror.com（全局生效，运行时装插件同样走镜像） |
| Playwright 浏览器 | playwright CDN | npmmirror.com/mirrors/playwright |

手动控制：

```bash
# 强制按国内处理 / 强制按境外处理
docker build --build-arg IN_CHINA=yes -t dsh:latest .
docker build --build-arg IN_CHINA=no  -t dsh:latest .

# 有真实 HTTP 代理时直接传代理
docker build --build-arg HTTPS_PROXY=http://127.0.0.1:7890 -t dsh:latest .
```

## 其他运行模式

同一个镜像入口支持多种 profile：

```bash
docker run --rm dsh:latest headless "跑一下测试"   # 一次性 headless 任务
docker run --rm dsh:latest dsh --dump-config      # 原样透传给 dsh CLI
docker run --rm dsh:latest plugin add <name>      # 插件管理
docker run --rm -it dsh:latest bash               # 进容器排查
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | DeepSeek API 密钥（也可在 Web UI 设置 → 模型 中填写） |
| `DSH_HOME` | `/root/.dsh` | profile / 会话 / 凭据目录（持久卷） |
| `DSH_PORT` | `3080` | 监听端口（命令行 `--port` 优先） |
| `DSH_BIND_HOST` | `0.0.0.0` | bind host（patch 层读取；改成 127.0.0.1 仅容器内可访问） |
| `DSH_TRUSTED_HOSTS` | — | 逗号分隔的受信任 authority，域名/反代访问必填 |
| `DSH_PERMISSION_MODE` | — | `danger-full-access` 可临时关闭文件沙箱 |
| `DSH_DOCKER_ACCESS` | `false` | dshd 是否把宿主机 Docker Socket 挂入 DSH |
| `DSH_DOCKER_SOCKET` | 自动检测 | 宿主机 Docker Socket 路径 |
| `CHROME_BIN` / `CHROMIUM_PATH` | `/usr/local/bin/chromium` | 内置 Chromium 路径 |

## 自动构建与更新（GitHub Actions）

- **`.github/workflows/build.yml`** — 构建并推送镜像到 GHCR
  （`ghcr.io/<owner>/<repo>`），打 `:latest` 和 `:<dsh版本>` 双标签，
  amd64 + arm64 双架构。触发方式：镜像相关文件变更、手动触发、被更新检查调用。
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
