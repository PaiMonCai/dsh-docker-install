# Runtime 与运维

本文说明 DSH Docker 运行时边界、开发环境、Docker Socket、浏览器、网络镜像、其他运行模式和环境变量。

> 返回项目首页：[README](../README.md)

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
