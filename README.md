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
│   ├── patch-remote-settings.js # 构建期启用远程 Settings
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
- 交互配置监听地址、工作区、数据卷、Trusted Hosts，并选择 DeepSeek 官方 API 或自定义 Base URL，再配置 API Key；
- 拉取镜像失败时按候选源自动回退，并允许输入自定义镜像；
- 创建持久卷和工作区，默认设置 `Asia/Shanghai` 时区、`1g` 共享内存与沙箱可写的 npm cache，启动容器并等待 Web UI；
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
docker build --build-arg DSH_VERSION=0.1.6-alpha.2 -t dsh:latest .
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

## 其他运行模式

同一个镜像入口支持多种 profile：

```bash
docker run --rm dsh:latest headless "跑一下测试"   # 一次性 headless 任务
docker run --rm dsh:latest dsh --dump-config      # 原样透传给 dsh CLI
docker run --rm -v dsh-home:/root/.dsh dsh:latest \
  plugin --profile web add <name>                 # 安装到持久化的 Web profile
docker run --rm -it dsh:latest bash               # 进容器排查
```

镜像把 pnpm 固定为 dsh `0.1.5-rc.2` 官方使用的 `11.7.0`。如果已有数据卷中的
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
