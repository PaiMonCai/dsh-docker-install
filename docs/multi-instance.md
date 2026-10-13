# dshd 多实例部署与运维

> 适用：在同一台宿主机上同时运行 Standard、Research、Research Economics、Reverse，或多份不同镜像的 DSH，而不相互覆盖。

## 创建实例

原有 `dshd` / `dshd status` / `dshd update` **保持管理默认实例**（旧配置 `/etc/dshd/config.env` 不搬迁）。

```bash
# 先保留原 Standard 容器，再安装第二个 Research 容器
sudo dshd instance add study research

# 可继续创建 Economics / Reverse
sudo dshd instance add econ research-economics
sudo dshd instance add security reverse

# 列表与独立运维
sudo dshd instances
sudo dshd -i study status
sudo dshd -i study logs
sudo dshd -i study update
sudo dshd -i study backup
sudo dshd -i study rollback status
sudo dshd -i study config
sudo dshd -i study uninstall

# 等价写法
sudo dshd instance study restart
```

交互入口：`sudo dshd` → **[29] 多实例管理** → 新建或选择实例。选定实例后进入原有完整运维菜单，不需要维护另一套菜单实现。

命名规则：实例 ID 只允许小写英文字母开头，后接小写字母、数字或连字符（最长 32 位）；`default` 为保留名称。

## 自动隔离

以 `study` 为例（root 安装）：

| 资源 | 默认实例（兼容旧版） | study |
|---|---|---|
| 配置 | `/etc/dshd/config.env` | `/etc/dshd/instances/study/config.env` |
| 容器 | 旧容器名，通常 `dsh` | `dsh-study` |
| Web 宿主机端口 | 原端口，通常 `3080` | 自动寻找 `3082–3199` 可用端口 |
| DSH 数据 | 原数据目录/卷 | `/opt/dsh/instances/study/data` |
| 工作区 | 原工作区 | `/opt/dsh/instances/study/workspace` |
| 环境变量文件 | 原 `container.env` | 实例私有 `container.env` |
| 挂载规则 | 原 `mounts.conf` | 实例私有 `mounts.conf` |
| 备份、代理配置 | 原状态目录 | 实例私有状态目录 |
| 回滚容器 | `<旧容器名>-rollback` | `dsh-study-rollback` |

非 root 安装使用 `~/.config/dshd/instances/<id>` 保存配置，并使用 `~/dsh/instances/<id>` 作为数据/工作区基础目录。

安装器会给新容器附加 `io.caicailo.dsh.instance=<id>` 所有权标签；实例管理器拒绝接管没有匹配标签的同名容器。原默认实例仍能管理旧的无标签容器，但不会接管已经归属于命名实例的容器。

端口分配会检查已注册实例（包括停止状态）、当前 TCP 监听端口。创建时的检测不能替代最终 Docker 端口绑定校验；并行创建或其他程序抢占端口时仍可能冲突，失败后可通过独立实例配置调整端口并重试。

## 版本与升级

每个实例有自己的 `DSH_IMAGE`、`DSH_EDITION`、Research Pack 和所有运行配置，因此：

- `dshd -i study update` 只替换 `study` 容器，原 Standard 不受影响。
- `dshd -i study edition standard` 只在 study 内切换镜像，不会转换其他实例。
- `dshd -i study rollback` 使用 `dsh-study-rollback`，不影响默认实例回滚点。
- 各实例的 `backup`、`restore` 和 `uninstall` 分别操作自身数据；命名实例卸载不会删除全局 `/usr/local/bin/dshd`。

如需固定版本，执行 `sudo dshd -i study config` 将镜像地址修改为精确版本标签，再按该实例更新/重建。请注意当前 Edition 切换命令仍会回到所选 Edition 的默认浮动镜像标签。

**共享目录是显式配置，不是默认行为**。如果手动把两个实例配置成同一数据卷或同一工作区，它们仍可能互相影响；不要用同一个 `DSH_DATA_DIR` / `DSH_VOLUME` 存放两份运行状态。

## Reverse 向后兼容

原有 `dshd reverse install/status/update/logs/menu` 和历史 `/etc/dshd-reverse` 保持不变；`dshd instances` 也会显示历史 Reverse。若已安装历史 Reverse，`dshd -i reverse status` 可使用兼容路由，不会搬迁、覆盖或复制 Reverse 的数据。

## 安全与操作说明

- 新建实例会检查容器名占用，禁止静默接管其他现有容器。
- 对命名实例运行 `uninstall` 时，请仔细确认是否删除数据目录、工作区和实例配置。删除配置后，其实例 ID 不再显示于列表，但此前保留的数据并不会自动销毁。
- API Key、Web Token、插件、会话、代理和备份都是实例私有的（除非人为共享路径）。
- 不要为所有实例默认打开宿主 Docker Socket。该权限等同于强大的宿主机管理权限。
- 原仓库 `docker-compose.yml` 仍主要用于手动单实例部署；上述多实例功能走 `dshd` 管理器自身的 Docker CLI 创建流程。

## 验证

```bash
bash -n dshd
bash tests/test-dshd-instances.sh
bash tests/test-dshd-reverse-install.sh
bash tests/test-dshd-storage.sh
bash tests/test-dshd-rollback.sh
```

上述单元测试使用隔离的临时目录和模拟 Docker 命令，不能代替真实 Docker 环境中的多容器冒烟验证。建议合并前在测试宿主机实际创建两个实例，分别验证访问、独立升级、失败回滚和卸载。
