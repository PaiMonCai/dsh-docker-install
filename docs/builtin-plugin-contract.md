# 内置 Web 插件接入规范 v1

目标：让每个内置功能能独立发布和回归验证，而不修改 DSH 官方侧边栏或使用第三方插件安装器。

## 文件与加载边界

镜像中的每个内置 Web 插件位于 `docker/plugins/<id>/`，至少包含：

- `package.json`：稳定 `name`、`exports["./client"]` 和 `dsh.client.platform=web`。
- `index.js`：DSH 服务端 Cordis 插件，不能在模块导入阶段擅自读写用户 Profile。
- `client.js`：通过 `window.__ModuleLoader__.load({id, factory})` 注册的浏览器客户端。
- `cordis.patch.yml`：仅包含该功能的官方 DSH 配置补丁，`name: ./index.js` 从补丁位置解析。

**新增插件不是直接向用户 Profile 执行 `dsh plugin add`。** 由镜像 Dockerfile 打包，经容器启动脚本的 `append_native_web_patch` 使用官方 `dsh web --patch` 机制装载；全部启动器 `--patch` 参数必须放在 Web 应用的 `--no-open`、`--port` 等选项之前。新插件需有明确环境开关与默认值，且在 CI 中验证启用/禁用行为。

插件必须允许完全禁用，不得因自身可选服务不可用使核心 DSH Web 无法使用；但必需插件文件缺失属于镜像构建错误，应明确失败。

## Icon Dock 快捷入口契约

所有希望显示在侧边栏的功能，应使用全局 **`window.__dshDockerIconDockV1`** 注册，而不是自行注册 `sidebar.footer.action`。

```js
const entry = {
  id: 'example.tools',        // 稳定、唯一、长度受限，升级时不要更换
  label: '我的工具',
  icon: 'terminal',           // 内置图标名称
  order: 300,
  onClick() { /* 打开原生页面或本插件弹窗 */ },
}
const dock = window.__dshDockerIconDockV1
if (dock) dock.register(entry)
else (window.__dshDockerIconDockPendingV1 ||= []).push(entry)
```

卸载或热替换时调用 `unregister(id)`；动态插件应确认订阅与事件监听能正确清理。业务 API、权限校验和弹窗所有权都归功能插件，Icon Dock **只管理显示、排序、溢出与点击分发**。

入口状态有三个位置：`dock`（优先显示，超过容量自动进入更多）、`more`（显式收纳）、`hidden`（在图标栏不呈现，但插件仍启用）。展开侧边栏 5 列×2 行，最多 9 个入口 +「更多」；收起后 2 列×2 行。

官方导航依然来自 DSH 的 `sidebar.panellist`，**复用原始 React 图标**与 `ctx.layout.selectPanel(id)`；无法安全复用的图标退回默认图标，不复制官方业务组件。

## 升级与安全

1. 禁止在内置插件启动过程执行 `pnpm add`、直接编辑第三方包锁文件或关闭供应链安全检查。
2. 内置插件不得在导入阶段变更 `/root/.dsh`；确需迁移的状态必须版本化、幂等、可备份。
3. 后端要做权限验证，Icon Dock 的隐藏/显示不等于授权。
4. 前端图标不能注入不受信任的 HTML；保证键盘可访问、合理 aria 名称、弹层可关闭。
5. 提交时至少包含组件单元测试、注册和卸载场景、原生加载配置校验；CI 镜像构建后验证实际 Web 启动和浏览器模块注入（含插件诊断/Chromium E2E）。

详见 [图标管理文档](icon-dock.md)、[安全升级与回滚](safe-upgrade-rollback.md)。
