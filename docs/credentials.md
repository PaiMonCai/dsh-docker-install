# Git / SSH Credentials

DSH Docker 提供独立的 Git / SSH 凭据注入层，让 Agent、Shell 和 Git CLI 在容器内访问 GitHub 或 GitHub Enterprise，同时不改变 `dsh-source-control` 的本地-only 权限边界。

> `source_control` 仍然只负责本地 status / diff / stage / commit。远程 clone / fetch / pull / push 应由独立的远程 Git 工具承担。

## 推荐顺序

凭据优先级：

```text
SSH Agent
  ↓
dshd 管理的只读私钥文件
  ↓
DSH_GITHUB_SSH_KEY_B64 环境变量兜底
```

推荐优先使用 SSH Agent；在无人值守服务器上使用只读私钥文件。Base64 环境变量模式主要用于纯 Docker Compose 场景。

## 1. SSH Agent（推荐）

宿主机已有 `ssh-agent` 且已加载 GitHub key：

```bash
dshd credentials ssh-agent set
dshd recreate
```

也可以显式给 socket：

```bash
dshd credentials ssh-agent set /run/user/1000/ssh-agent.socket
```

DSH 只拿到 Unix socket；私钥本身不复制进容器。

关闭：

```bash
dshd credentials ssh-agent clear
```

## 2. 只读私钥文件

把专用于 GitHub 的 key 导入 dshd：

```bash
dshd credentials github-ssh set ~/.ssh/id_ed25519
dshd recreate
```

dshd 会把 key 复制到自己的 credentials 目录并设置为 `0600`，启动容器时只读挂载到：

```text
/run/dsh-credentials/github_ssh_key
```

entrypoint 再复制到临时运行目录，并生成专用 SSH config。key 不进入 Docker `Config.Env`。

删除：

```bash
dshd credentials github-ssh clear
```

## 3. 环境变量兜底

纯 Compose 场景可以：

```bash
base64 -w0 ~/.ssh/id_ed25519
```

然后写入 `.env`：

```env
DSH_GITHUB_SSH_KEY_B64=...
DSH_GIT_USER_NAME=Your Name
DSH_GIT_USER_EMAIL=you@example.com
```

entrypoint 会在启动时解码到临时运行目录并设置 `0600`。

> **安全边界：** Docker 容器环境变量可以通过 `docker inspect` 读取。尤其开启 `dshd docker on` 后，DSH 自己就能检查宿主机 Docker 元数据。因此不要把环境变量模式当作强秘密隔离。

## Git identity

```bash
dshd credentials git-identity set "Your Name" you@example.com
```

容器启动时会配置：

```bash
git config --global user.name ...
git config --global user.email ...
```

清除：

```bash
dshd credentials git-identity clear
```

## GitHub Enterprise / 自定义 Host

默认：

```text
github.com
```

修改：

```bash
dshd credentials host set github.example.com
```

生成的 SSH 配置固定使用 `User git`，适用于 GitHub / GitHub Enterprise 的标准 SSH Git 协议。

## Host key 校验

默认：

```text
StrictHostKeyChecking accept-new
```

第一次连接会接受并把 host key 持久化到：

```text
$DSH_HOME/credentials/ssh/known_hosts
```

之后 key 变化会被拒绝。

更严格的做法是先导入你已经从可信渠道核验过的 `known_hosts`：

```bash
dshd credentials known-hosts set ./known_hosts
dshd credentials strict-host-key set yes
dshd recreate
```

不要把未经验证的 `ssh-keyscan` 输出直接当成“已验证”的安全来源。

## 查看状态

```bash
dshd credentials status
```

示例：

```text
Git SSH mode: mounted key file (/etc/dshd/credentials/github_ssh_key)
Git SSH host: github.com
Host key policy: accept-new
Known hosts: persistent accept-new store
Git identity: Your Name <you@example.com>
```

## 容器内行为

entrypoint 根据凭据生成临时 SSH 配置，并为 DSH 进程树导出：

```text
GIT_SSH_COMMAND=ssh -F /run/dsh-git/ssh_config
```

因此这些命令会自动使用同一凭据：

```bash
git clone git@github.com:OWNER/REPO.git
git fetch
git pull
git push
```

也可以进入容器验证：

```bash
dshd shell
git config --global --get user.name
git config --global --get user.email
ssh -G github.com | head
```

## 与 Agent 工具的边界

这一层只解决“运行时是否拥有 Git/SSH 凭据”。

它不会自动扩大 `dsh-source-control` 的能力。该插件仍保持本地-only；后续远程 Git 能力应通过独立工具（例如 `dsh-git-remote`）提供，并单独控制 push、force-push、删分支等权限。
