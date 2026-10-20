# Web 管理迁移 · 第四批：精简 CLI 与灾难恢复入口

> 第四批叠加在 [第三批](web-management-phase3.md) 之上，仅变更 `dshd` 的交互菜单路由、卸载确认顺序、对应测试和文档。本批**没有移除任何 Web / 宿主机需要的 `cmd_*` 底层命令**。

## 改造目标

日常运维入口已由容器内的 `dsh-instance-manager` Web 插件负责，默认 `dshd` 菜单无需继续罗列完整代理、Edition、配置、Dashboard 细项。终端要在容器关闭、Web 断线、执行器损坏或错误更新时独立可用。

```text
dshd                              → 精简的六入口 Rescue Menu
dshd menu rescue                  → 同上
dshd menu legacy                  → 兼容旧版六大分类 40 项运维菜单
dshd -i <ID> menu [legacy]        → 命名实例也可使用同一组入口
dshd web status / enable / disable→ 无 Web 页面也可查看/修复后台
dshd <原有子命令>                 → 所有历史 CLI 命令保持不变
```

## 精简后的交互菜单

| 顶级入口 | 救援功能 |
|---|---|
| 01 安装与实例 | 安装/初始化、查看/新增/选择实例、切换回默认实例 |
| 02 Web 管理修复 | 检查宿主机执行器、重新启用/修复 Web 管理、禁用 Web 通道 |
| 03 紧急救援 | 状态、启动/停止/重启、日志、回滚点检查、旧版容器回滚 |
| 04 数据保护 | 备份、手动恢复、查看存储位置 |
| 05 诊断与维护 | 环境诊断、插件自检、自更新 dshd |
| 06 卸载当前实例 | 终端专用危险卸载，逐步明确确认 |

原交互菜单保留在 `dshd menu legacy`，方便必须进行特殊配置的高级管理员，不作为默认路径向普通用户展示。Web 执行器继续调用 `dshd update/recreate/web-switch/proxy/... ` 命令实现实际宿主操作，不引用菜单渲染函数。

### 本批修复的危险卸载顺序

旧版流程在确认删除主容器之前就删除 Research Dashboard；删除主容器拒绝时仍可能继续删除数据等。现在要求：

1. 必须交互式终端；不接受无人值守卸载。
2. 先明确确认进入当前实例的卸载流程（默认否）。
3. 如存在主容器，单独确认删除（默认否）；拒绝直接退出，主容器及附属资源不受影响。
4. Docker 删除主容器成功且不存在后，才处理 Dashboard、Sidecar、网络、数据和配置。
5. 数据卷、工作区、状态目录等仍**各自单独确认，默认否**。不扩大 Web 权限，不增加「网页一键卸载」。

此改动不会保证任何恢复操作天然安全：当前 `dshd restore` 仍存在先删除当前数据后解压归档、并且缺少强制完整预校验的历史风险。第四批只提供醒目的危险提示与菜单二次确认，**正式启用 Web 数据恢复前必须另行修复预检、回滚与临时目录原子切换**。重要数据在恢复前应完成离线备份。

## 兼容与验收

- `tests/test-dshd-interactive.sh` 继续完整跑**旧版菜单的输入循环、Token 子菜单、Ctrl-C 与 EOF 回归**；仅将入口替换为明确的 `menu_legacy`。
- `tests/test-dshd-rescue-menu.sh` 校验精简菜单的页面和命令路由，Web 修复与停机等危险动作在非 TTY 默认拒绝、卸载明确确认前绝不执行 Docker 命令、容器删除必须先于 Dashboard 删除。
- 继续跑原有 `tests/test-dshd-web-management.sh`、Web/宿主机白名单契约、Node UI 和 Python 执行器回归。
- 不访问真实 Docker 或 systemd 服务的测试全部使用隔离临时状态目录/函数替身；真实 Docker 更新及回滚测试留待临时部署环境验收。

```bash
bash -n dshd
bash tests/test-dshd-rescue-menu.sh
bash tests/test-dshd-interactive.sh
bash tests/test-dshd-web-management.sh
bash tests/test-dshd-web-switch.sh
python3 tests/test-web-manager.py
node --test tests/test-management-operations.mjs tests/test-instance-manager.mjs tests/test-instance-manager-ui.cjs
```

## 上线与回退

四个 PR 为串联提交，需要按第一批、第二批、第三批、第四批的顺序集成。上线前为生产实例创建完整备份，确认真实 Docker 实例 Web 管理路径可访问，并验证 `dshd web status`、执行器 `management.operations`、升级与回滚操作。更新后如果 Web 失联，可直接登录宿主机执行 `dshd web status`、`dshd web enable`，必要时 `dshd rollback status` / `dshd rollback apply`。如遇新的终端菜单不适配特殊场景，用 `dshd menu legacy` 返回旧菜单，避免急于回滚镜像。
