# DSH 完整实例备份：导出、导入、自动备份

> 目前为独立功能 PR。**不要把此功能当成无需验收的生产级灾备保证**：可恢复性必须用一份测试归档实际导入并验证。跨系统架构、外部服务与镜像供应问题可能导致运行状态有差异。

## 范围

`.dshbak` 完整归档包含：Docker 持久化的 `/root/.dsh`（会话、模型配置、认证、已安装插件及其数据）、`/workspace`、宿主机当前实例的 `config.env` / `container.env` / 代理设置和其他配置、`mounts.conf` 声明的全部自定义目录内容，以及原镜像引用和能识别到的不可变 `sha256` digest。归档内有格式版本、逐分区 SHA-256、大小和原 Web 后台启用标记。

**备份不等于打包 Docker 镜像本身。** 新机必须有 Docker 并能拉取原镜像 digest；自定义、已经被删除的镜像建议另用 `docker save` 离线保存。外部数据库、SaaS/API 供应商状态、未在 DSH 挂载中的宿主机目录、单独部署的其他容器、用户在容器*非持久层*直接修改的文件以及反向代理 DNS/证书不在本归档内。被管理的内置插件属于镜像内容，须用原镜像复原。对于启用公网域名、代理环境的实例，需重新验证域名、端口和对外路径。

## Web 操作

新版可在 **DSH Web → 实例管理 → 备份与恢复** 使用图形界面完成归档导出、下载、上传、验证、导入为全新实例、自动备份开关和保留策略。归档上传单文件上限 **1 GiB**，超过此大小请从宿主机传输后使用 CLI。

需要同时升级 Web 镜像和宿主机 `dshd 0.12.3+`，再执行 `dshd web enable` 更新挂载及执行器。归档包含明文凭据，Web 容器能够读取授权备份目录，请仅提供给可信管理员，不要公开给不可信 Agent。

## 完整备份操作

```bash
# 可在不停止容器的情况下暂停 DSH 的写操作进行快照，然后自动解除暂停
sudo dshd backup export
# 或自定义位置，便于复制到其他机器
sudo dshd backup export /root/dsh-migration.dshbak

sudo dshd backup verify /root/dsh-migration.dshbak

# 复制归档到新宿主机；导入到一个“全新”实例 ID，默认不覆盖已有实例
sudo dshd backup import /root/dsh-migration.dshbak restored
sudo dshd -i restored status
sudo dshd -i restored logs
# 若新机已配置 systemd，需要重新启用 Web 宿主机执行器
sudo dshd -i restored web enable
```

导入过程中依次检查归档外层结构、清单、长度、SHA-256、分区内路径穿越、软链接逸出、硬链接与设备文件；任何检查失败都拒绝导入。恢复在临时目录完成后，按数据、工作区、实例配置的顺序提交，**配置最后出现**，以避免半完成实例被 dshd 接管。若后续 Docker 启动失败，文件保留供人工检查和重试；不要误以为 Docker 启动失败就已经完整回滚。

导入会为新实例重分配空闲 Web / Dashboard 端口和容器名、自定义挂载宿主机路径，并默认关闭 Docker Socket 宿主机权限以避免在新机器静默提权。原凭据与插件配置被恢复，不会自动删除；请确保旧实例不再同时使用同一第三方账号的不可并发状态。原 Web 后台服务需在新机重新启用。

## 自动备份（须宿主机 root + systemd）

```bash
sudo dshd backup auto on daily 7     # 每天备份，保留最近 7 份
sudo dshd backup auto on weekly 4    # 或每周备份，保留最近 4 份
sudo dshd backup auto status
sudo dshd backup auto off           # 仅停用 timer，不删除历史文件
```

每个实例的 systemd timer 独立，按不同 `STATE_DIR` 哈希命名。命名实例也支持 `sudo dshd -i ID backup auto on daily 7`。服务从宿主机执行，即使 DSH Web 不可访问，也会尝试连接 Docker 备份；Docker daemon 或镜像不可用时该次任务会失败，供 `journalctl -u dshd-backup-*.service` 查询。

快照会暂时 `docker pause` 正在运行的 DSH 主容器；这是短时服务中断，并不保证另一个宿主机进程或旁路 sidecar 不会并发写自定义目录。默认保留策略只删除匹配当前实例的 `*-auto-*.dshbak`，不清理手动归档或其他实例文件。磁盘空间不足会导致备份失败，建议监控空间和定期校验归档。

## 安全、兼容和恢复限制

备份 **包含 API Key、Token、会话信息、SSH 等可能的秘密**，归档权限为 `0600`、备份目录为 `0700`。跨机器传输建议使用加密存储和安全通道；仅导入可信备份。SHA-256 解决文件意外损坏，**不是签名/来源验证**。

现有 `dshd backup` 和 `dshd restore` 仍是旧版“仅持久化数据”命令，不会混用 `.dshbak` 完整归档。尤其旧 `restore` 存在清空数据风险，请优先使用新建实例的 `backup import`，不要把原 `restore` 用于迁移或自动任务。

验收：`python3 tests/test-portable-backup.py`、`bash tests/test-dshd-rescue-menu.sh`、Standard 镜像 CI。上线前请在一台隔离的 Docker 主机上，用真实备份验证重新启动、会话、凭据、插件以及自定义挂载都可用。
