# DSH Web 快捷入口管理（Icon Dock）

`dsh-docker-icon-dock` 是独立的 Web 客户端插件。它独占侧边栏 `sidebar.footer.action` 插槽，统一渲染多个功能插件的图标；功能插件只注册图标信息和点击回调，不再单独占一行。

## 用户操作

- 在 **DSH Web → 插件 → 快捷入口管理** 打开可视化布局编辑器：上方显示与侧边栏对应的 **5 列 × 2 行**预览格，支持鼠标拖放和触屏拖动排序，最后一格为「更多」收纳目标；下方列出所有已注册入口。
- 每个入口在完整列表中可独立选择 **快捷栏 / 更多 / 隐藏**。也可拖动列表条目调整顺序，或使用 **↑ / ↓** 按钮做键盘和触屏备用排序。图标尺寸可选 18/20/22/24px，「恢复默认」会重置自定义排序、分类、隐藏与大小。
- 图标栏固定 **最多两行**：展开时每行 **5** 个，显示最多 **9 个入口图标 + 第 10 格「更多」**；超出的快捷栏图标和手动设为「更多」的入口都进入菜单，不会再出现第三行。少于 10 个入口且无需收纳时，不显示「更多」。收起侧边栏时采用 **2 列 × 2 行**，最多 3 个图标 + 1 个「更多」。
- 偏好保存在当前浏览器的 localStorage（键 `dsh-docker-icon-dock:v1`），各浏览器独立。**「隐藏」不会显示在快捷栏或「更多」中，但不会停用插件功能**；「更多」则是仍然可点击的收纳区。旧版的显示/隐藏与排序偏好会继续被识别。
- 当可选搜索插件未安装时，不显示搜索图标；只有回收站（或其他已安装插件）可用。

## 官方侧边栏导航统一接管

- Icon Dock 默认读取上游 `sidebar.panellist`（如「插件」「自动化任务」和其它导航项），**直接继承对应注册记录的 React 原生图标组件**（不是按导航 ID 重画 SVG），与回收站、网络搜索统一排序。原生图标会得到与官方一致的 `size`、`active` 参数，支持函数组件、`React.memo` 和 `React.forwardRef`。
- 只有 `locale` 声明的官方图标，会由管理器通过 `ctx.locale.bind(namespace)` 获得与原生插槽一致的 `t` 参数，不再错误地回退为四宫格。点击图标仍调用上游 `ctx.layout.selectPanel(id)` 打开**原生页面**，不复制页面、不改变其服务端功能。只有依赖 `inject`、`store`、子插槽参数，或无法解析必需翻译函数的图标，才保留后备网格图标和可点击入口。
- 仅当全部原生导航项都已成功接入时，图标坞才通过样式隐藏上方的文字导航列表。若出现不兼容的条目，原始导航会保留，不会丢失入口。
- **插件 → 快捷入口管理 → 接管官方导航** 可随时关闭，恢复原来的文字导航；三种显示位置与自定义排序同样适用于原生入口。隐藏了官方「插件」导航时，「更多」仍会提供「插件设置（恢复入口）」以避免锁死管理页。
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

功能插件仍可通过 `renderIcon({size,h})` 提供自己的图标；官方导航优先直接复用其 React 组件，不需要二次维护图标映射。自定义图标回调应为纯渲染函数，不要注入未受信任的 HTML。没有可用图标时才使用默认网格。

可用 API：`register(entry)`、`unregister(id)`、`getAll()`、`setVisible(id, visible)`、`move(id, -1/1)`、`setSize(18/20/22/24)`、`reset()`、`subscribe(listener)` 和 `snapshot()`。功能插件只需使用注册/移除接口，别直接修改用户偏好。

「更多」浮层会根据视口自动选择位置，支持方向键、Home/End、Escape 和 Tab 键盘操作，窗口空间不足时不会强行伸出屏幕。

## 安装与独立性

镜像在 `/opt/dsh/plugins/dsh-icon-dock` 预装完整插件，由容器启动脚本通过 DSH 原生 `--patch /opt/dsh/plugins/dsh-icon-dock/cordis.patch.yml` 加载（该启动器参数位于 Web 应用参数之前）；**不调用 `dsh plugin add`、不运行 pnpm，也不需要 Web Profile 安装依赖**。`DSH_ICON_DOCK_ENABLED=false` 可禁用整个快捷入口栏。禁用管理器不会关闭搜索与会话管理后端。建议通过管理页隐藏单个图标。旧版 Profile 中曾经安装的内置插件，其旧选中项会在首次启动时有备份地退出；第三方依赖与 pnpm 锁文件不变。
