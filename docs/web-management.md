# DSH 内置实例管理

日常运维入口位于 DSH 的快捷栏和「插件 → 实例管理」。公共插件由 Standard
镜像提供，Research、Economics 和 Reverse 继承。无需额外的管理容器，也不要求
开启 Agent 的 Docker 项目管理权限。

## 当前能力

- 运行状态、健康检查、当前镜像版本和最近运行日志。
- 定时检查远端镜像，默认每 6 小时；可设置每小时、每天或关闭。
- 有更新时显示 Web 提醒；确认后后台拉取、替换容器并执行健康检查。
- 重启、重建、回滚，以及清理当前实例的旧容器和未使用镜像。
- sing-box 开启、关闭、重载、出口测试、节点切换、全部节点测速。
- 节点链接与 HTTP(S) 订阅导入、刷新全部订阅。
- 持久化任务记录、执行日志、重复提交保护和页面重连。

自动检查不会下载镜像或自动安装。点击更新并确认后，后续步骤无需保持浏览器连接。
升级与旧资源清理沿用 `dshd update` 的行为。默认不保留成功升级前的回滚容器；
回滚只在还有回滚点时可用，且不会恢复历史持久化数据。

## 启用

支持运行 systemd 的 Linux 宿主机，需要 root、Python 3.8+ 和 util-linux 的 `flock`。
Python 执行器仅使用标准库。新安装及执行新版 `dshd update` 时，在满足条件的宿主机
上自动配置；旧部署也可手动运行：

```bash
sudo dshd web enable
sudo dshd web status
sudo dshd -i study web enable
```

启用会重建当前实例以添加管理通道。安装前校验执行器 SHA-256，与当前 `dshd`
不匹配的文件不会安装。安装来源依次为本地仓库、当前容器内置副本、项目 Raw 地址。

未启用时，内置页面显示安装说明，原有 DSH 功能继续可用。非 systemd、非 root 或
没有 Python 3 的环境继续使用 CLI，不会强制安装宿主机依赖。

```bash
sudo dshd web disable
```

关闭会停止后台并重建实例移除挂载，留下禁用标记，后续更新不会自动重新启用。
首次安装前也可设置 `DSHD_WEB_MANAGEMENT=off` 跳过自动配置。

## 执行边界

Web 插件通过 DSH 已认证的 `connection/request` 通道提供界面和任务提交。
写请求需要专用 Header、JSON 和浏览器同源请求。该入口面向可信的实例管理员；
它不提供多租户角色授权，也不能隔离同一容器内已经具备 root/文件访问权限的 Agent
或其他进程。管理通道应视为有权更新、重启该实例的能力。

宿主机 systemd 服务负责执行固定白名单操作，只管理安装时绑定的实例。
Web 不传 Shell 命令、可执行文件、配置路径、镜像地址或其他实例 ID。
节点地址作为独立参数传递，订阅不接受本地文件路径。

每个实例只挂载两处：

| 宿主机 | 容器 | 权限 |
|---|---|---|
| `$STATE_DIR/web-management/requests` | `/run/dsh-management/requests` | 读写任务队列 |
| `$STATE_DIR/web-management/results` | `/run/dsh-management/results` | 只读状态和任务结果 |

宿主机配置、私有设置和 Docker Socket 不通过该通道挂入 DSH。
导入链接从任务队列领取后即删除，不写入公共任务记录；运行与任务日志做敏感链接脱敏。
代理本身仍按原逻辑将节点、订阅保存到宿主机实例私有目录。

宿主机的服务文件名由实例状态目录生成，不随 DSH 容器更新。容器停止后，执行器仍
继续替换、健康检查和失败恢复。页面恢复连接后读取同一任务结果。
执行器重启时，将已在运行的任务标记为中断，不自动重放。
队列任务超过 10 分钟会过期，避免长时间停机后意外执行旧更新请求。

Web 任务串行执行；普通 CLI 写命令也使用实例锁，冲突时明确拒绝。
兼容的旧交互菜单仍保留，迁移期间请勿在 Web 运维任务进行时从旧菜单修改实例。
CLI 不依赖 Web 或执行器在线，`start/stop/restart/update/rollback/logs/doctor` 仍可直接执行。

## 数据位置与排障

```text
$STATE_DIR/
├── web-manager.py                 # 与 dshd 匹配的宿主机执行器
├── web-management.enabled         # 挂载启用标记
├── web-management.disabled        # 手动关闭标记（关闭时存在）
├── web-management/
│   ├── requests/                  # 待领取任务
│   └── results/                   # 状态快照和最近 50 条任务记录
└── web-management-private/
    ├── settings.json              # 定时检查设置
    ├── release.json               # 最近更新检查
    └── executor.lock
```

如果页面长时间显示后台未连接，先执行 `dshd web status`。执行器故障可通过
`dshd web enable` 重新安装匹配版本；有其他实例操作正在执行时会拒绝修复。
管理服务不自动更新自身文件，升级宿主机 `dshd` 后可执行该命令更新执行器。

更新检查比较当前容器平台的镜像 config digest，避免把多架构索引 digest 与镜像 ID
混为一谈。仓库不可达或未返回当前平台时报告检查失败，不显示“已是最新版本”。

## 验证

`Instance Manager Checks` 覆盖任务接口、持久化、参数校验、CLI 桥接及旧功能回归。
Standard 镜像工作流额外运行真实 DSH 浏览器入口检查，以及独立临时实例的
Web → 宿主机执行器 → Docker 重启、更新、故障镜像恢复测试。
该 Docker 测试仅替代远端 registry 传输，容器替换和健康检查使用真实 Docker。
