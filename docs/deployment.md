# 部署与访问

本文收纳原根 README 中偏部署、访问和反向代理的详细说明。根 README 只保留最短上手路径。

> 返回项目首页：[README](../README.md)

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
docker build --build-arg DSH_VERSION=<dsh版本> -t dsh:latest .
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
