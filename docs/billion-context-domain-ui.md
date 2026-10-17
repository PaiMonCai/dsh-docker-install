# billion-context：DSH Docker + HTTPS 域名设置页兼容

本项目仅在用户自行通过 DSH Plugin Manager 安装了第三方
[billion-context](https://github.com/ranxianglei/billion-context) 时提供 UI 适配；
**不会预装 billion-context，也不变更模型流量的路由、压缩或凭据。**

## 为什么出现 127.0.0.1 拒绝连接？

第三方插件的 DSH 设置页使用其本地代理的原始 origin 创建 iframe，
如 http://127.0.0.1:18787/__bili/。
通过 HTTPS 域名访问 DSH 时，这个地址指向用户电脑，而非 Docker 容器。

## 实现方式（DSH_BILI_UI_BRIDGE=true，默认）

- DSH 内增加 /__bili/ 同源代理，依赖 **DSH Connection 的认证 Cookie / Host / Origin 检查**；
  未登录返回 401；非 owner 和跨站访问被拒绝。
- UI 代理只转发经过有限路径白名单的 billion-context 管理界面操作，
  上游 origin 从 DSH 自带的 **/bili/origin** 实时读取，并限制为容器回环 HTTP，
  绝不使用客户端指定的目标域名。
- 请求到本地 billion-context 时剥离 DSH Cookie、Authorization 等敏感头；
  独立验证修改请求来源，并将上游所需的 Host 与 Origin 改成可信回环地址。
- 启动时幂等修补**已安装在 Web Profile 中**的 billion-context
  dsh-native-client.js 的 iframe / embed 预检查 / 「打开 Web UI」三个地址，
  替换为相对路径 /__bili/；不改 Agent 的 /bili/origin 或代理配置。
- 未安装插件时什么也不做。插件自动更新后重启 DSH 会再次检查布局；
  如果上游构建方式变化，**拒绝盲改并打印警告**，避免损坏第三方插件。
- 同时兼容有、无 embed 预检查的客户端布局。`billion-context@0.1.197`
  不含该预检查，仍会修补 iframe 和「打开 Web UI」；CI 使用其实际 npm 包验证。
- 在 DSH WebServer 中注册的段前缀为 `/__bili`（无结尾斜杠），
  同时覆盖 `/__bili/` 首页和 `/__bili/overview` 等数据接口。
  CI 使用真实发布的 DSH 路由器验证注册、分派、认证和上游响应。
- 无额外监听端口，无新数据库、Sidecar、全局 npm 安装或公网开放端口。

## 操作

1. 更新 Standard 或 Reverse 镜像，并按现有方式重建容器。
2. 如果 billion-context 是在镜像运行期间安装的，请使用项目现有容器重启功能，
   或手动重启容器，让适配器检查已安装的 Web Profile bundle。
3. 使用原先的 DSH HTTPS 域名访问，在设置中打开「bili 设置」。
4. 浏览器 F12 → Network 中确认 iframe 及 /__bili/config 请求是
   https://你的DSH域名/__bili/...，不再请求用户电脑的 localhost。
5. 检查未登录访问 /__bili/config 返回 401（不应返回配置）。

如果旧镜像启动日志出现 `embed preflight: unsupported UI bundle layout (0)`，
说明此前适配器将缺少预检查误判为不支持，未写入任何修复。更新包含本次修复的
镜像后重建容器，再刷新浏览器即可；无需重装插件。iframe 的最终地址应以当前
DSH 域名开头，而非 `127.0.0.1`。

如果页面已能展示，但总览卡片为空并提示 `HTTP 404`，此前的同源桥将
DSH 段前缀误注册为 `/__bili/`：首页能够命中，数据接口却无法命中。
更新包含路由修复的镜像并重建容器后，刷新页面即可；无需调整域名反代规则。

提示：/bili/origin **仍然**返回 http://127.0.0.1:18787（或其他动态端口）；
这是 Agent 的本地模型代理真实位置，属于预期，不再用作浏览器 iframe 地址。

适配器使用容器内 DSH_BIND_HOST / DSH_PORT（默认 3080）读取实时 origin；
如果人为通过自定义 Web 启动参数改变了容器内部 DSH 端口，需同步设置 DSH_PORT。

## 回退

在 docker-compose.yml 或 docker-compose.reverse.yml 的环境变量设置：

    DSH_BILI_UI_BRIDGE: "false"

重建/重启后，启动脚本将使用修补前的备份恢复插件的浏览器代码，
并不注册同源代理。不会删除第三方插件及其配置或会话。

警告：插件源代码属于第三方；当前适配针对其已知 dsh-native-client 构建布局。
在真实运行的 billion-context 版本升级后，仍需通过实际浏览器验收。
若日志出现 unsupported UI bundle layout，请保留错误和插件版本，
不要手工打开 18787 公网端口。

## 与 Nginx / OpenResty 的关系

原有 Nginx 仍只需将 DSH 域名反代至 DSH Web 服务。
不要创建无认证的 /__bili/ → 18787 反向代理，也不要在 Docker ports
中额外映射 18787：安全门禁由 DSH 同源桥而不是公网裸代理完成。

浏览器 Console 若还持续出现 /plugins/events HTTP/2 报错，那是另一项
DSH SSE/streaming 反代兼容问题，应独立检查 Nginx 的 response buffering、
HTTP/2 和连接生命周期，不能通过开放 billion-context 端口解决。
