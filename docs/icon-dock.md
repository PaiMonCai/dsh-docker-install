# DSH Web 快捷入口管理（Icon Dock）

`dsh-docker-icon-dock` 是独立的 Web 客户端插件。它独占侧边栏 `sidebar.footer.action` 插槽，统一渲染多个功能插件的图标；功能插件只注册图标信息和点击回调，不再单独占一行。

## 用户操作

- 在 **DSH Web → 插件 → 快捷入口管理** 按需显示/隐藏回收站、搜索以及以后新增的图标。
- 用上下移动按钮调整顺序，选择 18/20/22/24px 图标尺寸，点击恢复默认清空偏好。
- 图标始终无可见中文文字；保留鼠标悬停中文提示和无障碍名称。图标超出容器宽度时允许横向滚动。
- 偏好保存在当前浏览器的 localStorage（键 `dsh-docker-icon-dock:v1`），各浏览器独立。隐藏图标不会关闭插件功能。
- 当可选搜索插件未安装时，不显示搜索图标；只有回收站（或其他已安装插件）可用。

## 官方侧边栏导航统一接管

- Icon Dock 默认读取上游 `sidebar.panellist`（如「插件」「自动化任务」和其它导航项），将它们转换为纯图标，与回收站、网络搜索统一排序。
- 点击图标调用上游 `ctx.layout.selectPanel(id)` 打开**原生页面**，不复制页面、不改变其服务端功能。
- 仅当全部原生导航项都已成功接入时，图标坞才通过样式隐藏上方的文字导航列表。若出现不兼容的条目，原始导航会保留，不会丢失入口。
- **插件 → 快捷入口管理 → 接管官方导航** 可随时关闭，恢复原来的文字导航；显示开关、排序对原生入口同样有效。
- 图标坞在此使用官方 `sidebar.panellist` 的注册与订阅接口；原生导航隐藏采用针对目前 DSH Web `panelList` 样式类的兼容适配，需在新版 DSH 镜像升级时回归检验。若上游修改样式类，最坏结果是文字导航重新出现，而不是页面不能访问。

## 新插件的接入约定

在功能插件的 Web client `apply(ctx)` 中调用：

```js
function registerShortcut() {
  const entry = {
    id: 'example.my-tools', // 稳定 ID
    label: '我的工具',
    icon: 'terminal', // trash | search | settings | terminal | link | grid
    order: 300,
    onClick: () => openMyTools(),
  }
  const dock = window.__dshDockerIconDockV1
  if (dock) dock.register(entry)
  else (window.__dshDockerIconDockPendingV1 ||= []).push(entry)
}
```

管理器允许功能插件在任意顺序加载。注册前若管理器还未加载，待处理队列会在管理器初始化时被消费。业务弹窗依然由功能插件自己注入 `shell.overlay`。以后不要再为每一个入口各自注入 `sidebar.footer.action`。

还支持 `renderIcon({size,h})` 回调生成自定义 React 图标；不要把未受信任的 HTML 拼接到页面。未知内置图标名称使用默认网格。

可用 API：`register(entry)`、`unregister(id)`、`getAll()`、`setVisible(id, visible)`、`move(id, -1/1)`、`setSize(18/20/22/24)`、`reset()`、`subscribe(listener)` 和 `snapshot()`。功能插件只需使用注册/移除接口，别直接修改用户偏好。

## 安装与独立性

镜像在 `/opt/dsh/plugins/dsh-icon-dock` 预装插件，由 `ensure-dsh-icon-dock` 幂等安装到 Web Profile；`DSH_ICON_DOCK_ENABLED=false` 可禁用整个快捷入口栏。禁用管理器不会关闭搜索与会话管理后端，只会让统一入口栏消失。建议通过管理页隐藏单个图标。
