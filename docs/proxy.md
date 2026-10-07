# DSH 国际网络出口（sing-box）

`dshd proxy` 为 DSH 容器提供一个可选的 sing-box sidecar 出口。默认关闭；未启用时现有部署保持直连，不改变容器网络。

## 架构

启用后，dshd 会创建：

- `${DSH_NAME}-proxy`：sing-box sidecar；
- `${DSH_NAME}-egress`：仅供 DSH 与 sidecar 通信的 Docker network；
- sing-box `mixed` inbound，默认监听容器内 `7890`；
- DSH 内的 `HTTP_PROXY` / `HTTPS_PROXY` / 小写同名变量；
- `NODE_USE_ENV_PROXY=1`，让 Node 24 的 fetch/http/https 读取代理环境；
- `NO_PROXY`，默认绕过 localhost、`host.docker.internal`、DSH 自身与 sidecar。

代理端口不会映射到宿主机公网。

## 常用命令

第一次使用推荐直接运行向导：

```bash
dshd proxy setup
```

向导会完成“添加/选择节点 → 设为当前节点 → 是否启用 → 连通测试”。交互输入代理凭据时不会进入 shell history。

也可以使用完整命令：

```bash
dshd proxy add hk01 http://user:password@proxy.example.com:8080
dshd proxy add jp01 socks5://127.0.0.1:1080
dshd proxy list
dshd proxy use hk01
dshd proxy enable
dshd proxy test
```

代理已开启后，`dshd proxy use NAME`、更新当前节点和修改 sing-box 镜像只会重新加载 sidecar，**不会重建 DSH 容器**。只有首次开启、关闭代理或修改 mixed 端口这类会改变 DSH 网络环境的操作才需要重建 DSH。

关闭并恢复直连：

```bash
dshd proxy disable
```

查看状态、重新加载和日志：

```bash
dshd proxy status
dshd proxy reload
dshd proxy logs
```

`status` 会区分 sing-box sidecar 状态与 DSH 实际路由状态，例如“代理已应用”“待重建 DSH 才能生效”或“直连”。节点列表只展示协议、主机和端口，不显示用户名、密码、UUID 等凭据。

## 分享链接导入

`dshd proxy add NAME URL` 和快速向导会自动识别以下常见链接：

- `http://` / `https://`
- `socks://` / `socks5://` / `socks5h://`
- `vless://`
- `trojan://`
- `hysteria2://` / `hy2://`
- `ss://`（Shadowsocks SIP002）

例如：

```bash
# NAME 可以显式指定
dshd proxy add hk-vless 'vless://UUID@example.com:443?security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws'

# 也可以省略 NAME；优先从 #备注自动命名
dshd proxy add 'trojan://PASSWORD@example.net:443?security=tls&sni=example.net&type=grpc&serviceName=TunService#Tokyo%20Edge'
dshd proxy add 'hysteria2://PASSWORD@example.org:443?sni=example.org&obfs=salamander&obfs-password=SECRET#US'
dshd proxy add 'ss://BASE64_USERINFO@example.com:8388#SS'
```

省略 NAME 时，`#Tokyo%20Edge` 会生成类似 `Tokyo-Edge` 的节点名；同名节点自动追加 `-2`、`-3`，没有备注则使用 `node1`、`node2`。

VLESS / Trojan 会映射常见 TLS、Reality、uTLS fingerprint、WebSocket、gRPC、HTTP、HTTPUpgrade、QUIC 参数；Hysteria2 支持常见 TLS / insecure / salamander 等 obfs 参数；Shadowsocks 支持 SIP002 的 base64url 用户信息与 plugin 参数。

解析器采取“**不静默丢关键参数**”原则：遇到未知 `security` 或 transport/type 会直接报错，提示改用原生 sing-box JSON，而不是生成一个看似成功但实际上连不通的节点。

## 订阅导入

支持 HTTP(S) 订阅 URL、本地文件和标准输入：

```bash
dshd proxy subscribe 'https://example.com/subscription'
dshd proxy subscribe /root/nodes.txt
cat /root/nodes.txt | dshd proxy subscribe -
```

支持两类常见订阅内容：

1. 多行原始分享链接；
2. 整份 Base64 编码后的多行分享链接。

订阅中暂不支持的协议（例如当前尚未解析的 VMess）会被跳过并在结果中计数；可识别但参数不受支持的节点会记为解析失败。导入不会在已有当前节点时静默切换出口；导入完成后用 `dshd proxy list` 查看，再用 `dshd proxy use NAME` 切换。

如果订阅 URL 自带 token，建议从 `dshd proxy` 交互菜单进入“导入订阅 URL / 文件”，避免把完整 URL 留在 shell history。

复杂或非标准节点仍可以直接导入 sing-box outbound JSON；对象必须使用 `"tag": "proxy"`：

```bash
dshd proxy add-json custom /root/outbound.json
```

也可以把单行 JSON 直接作为第三个参数，或用 `-` 从标准输入读取。

## DNS 与域名节点

sidecar 会配置 sing-box 1.14 的本地 DNS resolver，并通过 `route.default_domain_resolver` 解析代理服务器域名。因此节点地址既可以是 IP，也可以是域名。这个配置是 sing-box 1.14+ 对使用域名的 outbound 所要求的。

## 配置与安全

代理状态写入 dshd 的 `config.env`；节点配置保存在：

```text
$STATE_DIR/proxy/nodes/<name>.json
```

目录权限为 `700`，节点文件和运行时 `config.json` 为 `600`。节点 JSON 可能包含密码、UUID、密钥等敏感信息，不要提交到 Git。

sing-box 镜像默认固定为 `ghcr.io/sagernet/sing-box:v1.14.2`。若 GHCR 在本地网络不可达，dshd 会尝试南京大学 GHCR 镜像；也可以手动指定：

```bash
dshd proxy image registry.example.com/sing-box:v1.14.2
```

## 当前边界

这是环境变量代理模式，不是 TUN/透明代理。大多数 curl、Git、npm/pnpm、Node 网络请求会走代理；完全忽略 HTTP(S) 代理变量的软件仍可能直连。

第一阶段刻意不授予 `NET_ADMIN`、不挂载 `/dev/net/tun`。如果后续需要 Chromium 或特殊 SDK 的强制透明出口，可以在此基础上增加单独的 transparent/TUN 模式，而不改变当前安全默认值。
