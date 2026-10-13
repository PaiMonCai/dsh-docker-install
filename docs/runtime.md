# Runtime 与运维

本文说明 DSH Docker 运行时边界、开发环境、Docker Socket、浏览器、网络镜像、其他运行模式和环境变量。

> 返回项目首页：[README](../README.md)

## 关键设计

1. **禁止通配地址，运行时选择具体网卡 IP**：从 DSH `0.2.1-alpha.2` 起，CLI 与
   webserver 都拒绝 `0.0.0.0` / `::`（Web API 可以执行代码，禁止绑定所有接口）。
   Docker 入口用 `docker/resolve-bind-host.js` 解析具体 IPv4/IPv6 地址，并通过
   `docker/dsh-bind.patch.yml` 传入上游 WebServer；没有外部网卡时回退到
   `127.0.0.1`。用户显式指定合法的 `DSH_BIND_HOST` 或 `--host` 可以覆盖。
   `DSH_BIND_HOST=127.0.0.1` 仅可在容器内部访问，Docker 端口发布通常无法转发到该地址。
   宿主机的端口监听范围则由 `dshd` / Compose 的 `127.0.0.1:PORT:PORT` 决定。
2. **Host 围栏**：回环 Host 永远受信任；域名/局域网访问要用 `DSH_TRUSTED_HOSTS`
   声明对外 authority（逗号分隔），否则 `/api` 返回 401/403。
3. **默认 root 运行**：bind mount 权限最省事，文件级限制交给 dsh 自己的沙箱。
   要降权加 `--user 1000:1000` 并保证挂载目录可写。
4. **历史 Workspace 自动自愈**：当前标准持久工作区是 `/workspace`。如果持久卷中仍有
   以旧 `cwd=/root/dsh` 创建的会话（对应 `$DSH_HOME/sessions/--root-dsh--`），而容器
   recreate 后 `/root/dsh` 已随旧 overlay 消失，入口脚本会在 DSH 启动前自动创建
   `/root/dsh -> /workspace` 软链接。它不会改写不可变的 SessionHeader，也不会让新会话继续
   使用旧路径；`dshd doctor` 会显示修复状态。

## 交互式菜单的错误边界

`dshd` 的交互菜单把每个动作都放在独立的子 shell 里执行（`run_action`），因此：

- 任意一步失败（镜像拉取失败、容器不存在、端口占用、权限不足等）只会终止**这一次操作**，
  打印原因后回到菜单，不会结束整个 `dshd` 进程，也不需要重新运行脚本；
- 菜单里按 `Ctrl-C` 只会取消当前操作并重绘菜单；想退出请用 `0` 或 `Ctrl-D`；
- 配置类流程（`8) 修改完整配置`、API、Hosts、挂载等）对每个字段即时校验并重问，
  回车保留当前值；
- 安装 / 切换版本会先写入配置再拉取镜像，镜像拉取失败时已填内容不会丢失，
  网络恢复后执行 `dshd update` 继续即可；
- 输入流提前结束（`Ctrl-D`）时视为放弃本次修改，已保存的配置保持不变；
- 配置文件损坏时菜单会提示并提供“备份并重置”，容器、数据目录和工作区都不会被删除。

非交互命令（如 `dshd install`、`dshd update`）保持“失败即退出并返回非零退出码”的语义，
便于脚本化调用。

`tests/test-dshd-interactive.sh` 覆盖以上行为。

## 插件市场重启

由 `dshd` 或本仓库的 `docker-compose.yml` 启动时，容器都带有
`restart: unless-stopped`，并注入内部标记 `DSH_DOCKER_RESTART=container`。
入口脚本会对已安装的 `dshmarket` 应用一个幂等兼容补丁：

```text
插件市场点击“立即重启”
        ↓
当前 dsh host 收到 SIGTERM
        ↓
tini / 容器进程树退出
        ↓
Docker restart policy 重新启动容器
        ↓
entrypoint → dsh web → 读取持久化 profile
```

这条路径不会在容器里再 spawn 第二个 `dsh web`，也**不需要挂载 Docker Socket**。
补丁只放宽 Docker NAT 带来的一个差异：浏览器虽然访问宿主机
`127.0.0.1:3080`，容器内看到的 socket peer 通常是 Docker 默认网关。适配器只接受
“当前容器默认网关”这一 peer，并继续保留 dsh-market 原有的 forwarding-header 拒绝、
loopback `Host` 与同源 `Origin` 检查，因此不会把该按钮扩展成远程域名的进程控制接口。

直接手写 `docker run` 且**没有** restart policy 时，本仓库不会自动注入这个标记；
此时 dsh-market 保持上游原始重启行为。首次安装 dshmarket、尚未经过一次容器启动补丁时，
可先执行 `dshd restart`。

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

## 自定义持久化目录

dshd 0.8.3 起支持独立于 `DSH_HOME` 和 `/workspace` 的额外目录挂载：

```bash
dshd mounts show
dshd mounts add /opt/dsh/ssh /root/.ssh
dshd mounts add /opt/dsh/reference /root/reference ro
dshd mounts remove /root/.ssh
```

挂载记录位于 `$STATE_DIR/mounts.conf`，每次 `dshd recreate` / `dshd update` 创建容器时都会重新转换为 Docker bind mount。宿主机源目录不存在时会自动创建；目标为 `/root/.ssh` 时源目录权限会收紧到 700。

为了避免自定义配置破坏 dshd 自身的运行边界，以下目标不能被覆盖：

```text
/
/root
/root/.dsh
/root/.dsh/*
/workspace
/workspace/*
/var/run/docker.sock
```

自定义目标之间同样禁止父子路径重叠。当前功能只管理**目录**，不接受任意 Docker 参数，也不把单个宿主机文件作为持久化项。

需要注意，自定义 bind mount 会把对应宿主机目录直接暴露给容器。不要把宿主机的 `/etc`、`/root`、Docker 数据目录等高权限目录随意以可写方式挂入。自定义挂载不会进入 `dshd backup` / `restore`，SSH 私钥等敏感数据需要独立备份。

`dshd doctor` 会检查 mounts 配置、宿主机源目录以及当前运行容器是否已经应用对应目标；修改挂载后如果尚未重建，会明确提示执行 `dshd recreate`。

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
| `DSH_BIND_HOST` | 容器具体网卡 IP（自动解析） | 支持显式设置具体 IPv4/IPv6；禁止 `0.0.0.0` / `::`；无外部网卡回退 127.0.0.1 |
| `DSH_TRUSTED_HOSTS` | — | 逗号分隔的受信任 authority，域名/反代访问必填 |
| `DSH_REASONING_EDITOR` | `true` | 是否启用内置自定义模型 `reasoningEfforts` 编辑器；`false` 时通过 DSH Plugin Manager 移除 |
| `DSH_PERMISSION_MODE` | — | `danger-full-access` 可临时关闭文件沙箱 |
| `DSH_DOCKER_ACCESS` | `false` | dshd 是否把宿主机 Docker Socket 挂入 DSH |
| `DSH_DOCKER_RESTART` | 由 dshd/Compose 注入 `container` | 内部 supervisor 标记；让 dsh-market 把“立即重启”委托给 Docker restart policy |
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


## 持久化 Web 首次登录 Token

官方 DSH 启动 Token 原本为进程级随机值，因此镜像重建后首次访问 URL 会变。
镜像在构建阶段对 DSH Connection 的**启动 Token 生成点**做精确版本适配，
不改动 Cookie 签名、Host/Origin 校验或浏览器会话验证。
CI 会启动真实镜像，并在完全移除再创建 Docker 容器后验证 Token 一致。

启动时从持久化的 `$DSH_HOME/.dshd-web-login-token.json` 读取 Token；
缺失则生成一次 32 字节高强度随机值，保存为 `0600`。
Token 仅进入 Web 进程环境，未进入 Docker 配置的环境变量列表。
非法 JSON、软链接、宽松文件权限都会拒绝启动 Web，而不是默默换成随机 Token。

`dshd token set` 安全交互输入自定义 Token；`dshd token reset` 换新随机 Token；
`dshd token status` 不输出明文，只显示 auto/custom 模式。修改后自动重启容器以生效。
已有浏览器 Cookie 的签名凭据独立于此 Token，重置首次登录 Token **不等于注销现有浏览器**。
保存了 DSH_HOME 的备份也可能包含 Token，请保护备份权限。

## Web 会话管理（删除 / 永久删除 / 回收站）

`dsh-docker-session-manager` 是容器内默认启用的 Web 插件；会话管理不再提供
`dshd sessions` CLI 命令。通过 DSH 左侧边栏底部的纯图标「回收站」入口管理已删除会话；快捷栏统一由独立的 `dsh-docker-icon-dock` 插件管理，在「插件 → 快捷入口管理」中可调整图标显示、顺序和大小；启用 Web Search 插件后，「网络搜索」放大镜默认与回收站并排，均不显示中文文字（悬停提示与无障碍名称保留）；
普通会话的 `···` 菜单只显示「删除会话」，永久删除仅位于回收站中，默认中文。

新版 Web 回收站是自适应的**会话管理面板**（桌面约 980px 宽，手机上全屏），不再只有小弹窗和单条操作：

- 顶部显示**全部数量 / 最近 7 天 / 已选数量**，支持标题或会话 ID 搜索、删除日期筛选（全部/7 天/30 天）、时间升降序及名称排序、手动刷新。
- 列表可以逐条勾选，或一键选择**当前筛选结果**；页面底部执行批量恢复，也可对选中的记录发起批量永久删除。
- **批量永久删除**除了弹窗确认，必须手动输入“永久删除”；单条永久删除仍需明确确认。操作不可撤销。
- 批量操作顺序调用原有的单条认证接口，**不是原子事务**：如果部分成功、部分失败，成功的记录会移出回收站，失败项留在列表并保留勾选以便重试。进行中显示处理进度，关闭和重复提交被禁用。
- `Esc`、焦点循环及点击遮罩关闭面板；正在执行删除/恢复时不允许关闭，以免误认为任务中止。
- 这些筛选/勾选仅存在当前页面，不修改持久化存储；服务端仍以回收站记录为永久删除的必要条件。

- **删除会话**：调用 DSH 原生 `workspaceRegistry.archiveSession(id)` 进行安全归档，
  再将会话 ID、标题和删除时间保存到
  `DSH_HOME/.dshd-session-trash-v2/session-*.json`。
  已删除会话从普通列表隐藏，但原始 JSONL 文件仍保留在 `sessions` 中；
  恢复操作会取消归档并移除回收站记录。
- **永久删除**：必须先通过「删除会话」加入回收站；服务端也检查回收站记录，
  拒绝绕过回收站直接删除。用户再次确认后，向 DSH 发出目标会话停止请求，
  直接将会话目录原子移出持久化扫描目录后物理清除；即使存在活跃 Agent 或
  独占写入句柄也会继续执行。不会重启 Docker，也不会删除工作区文件。
- **回收站恢复**：取消 DSH 原生归档并删除回收站标记；已永久删除的会话无法恢复。
- 所有请求必须通过 DSH Connection 已认证的 `/api` HTTP 通道；
  用户请求大小受限、会话 ID 被严格校验、符号链接路径会被拒绝。
- 会话存储删除不会删除 `/workspace` 项目文件，也不会级联删除 fork 子会话。
- Web 插件默认启用，设置 `DSH_SESSION_MANAGER_WEB=false` 可禁用（变更需要重建容器）。

**强制清理边界：** 上游 Session Persistence 不提供公开的删除 / 卸载 API。
强制删除会请求停止目标会话的工作，但不能保证原有持久化写入句柄已经
完全释放；如果仍有写入发生，它可能遇到文件不存在等错误。
为避免将已经清理的内存缓存会话重新显示在列表，插件会保留原生归档
墓碑记录；不会强制终止其他会话，也不会重启 Docker。
回收站保存的是可恢复的**逻辑删除标记**，只有执行永久删除才物理清理日志。
重要会话请先备份。

**升级兼容：** V1 曾经经 `DSH_HOME/.dshd-session-manager/pending` 队列和
`DSH_HOME/.dshd-session-trash` 保存离线删除记录。V2 不再创建新离线任务，
也不主动迁移或销毁旧回收记录；请先备份旧目录，需要时通过原版本或人工离线恢复。
