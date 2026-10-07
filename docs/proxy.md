# DSH 国际网络出口（sing-box）

`dshd proxy` 为 DSH 容器提供一个可选的 sing-box sidecar 出口。默认关闭；未启用时现有部署保持直连，不改变容器网络。

## 架构

启用后，dshd 会创建：

- `${DSH_NAME}-proxy`：sing-box sidecar；
- `${DSH_NAME}-egress`：仅供 DSH 与 sidecar 通信的 Docker network；
- sing-box `mixed` inbound，默认监听容器内 `7890`；
- DSH 内的 `HTTP_PROXY` / `HTTPS_PROXY` / 小写同名变量；
- `NODE_USE_ENV_PROXY=1`，让 Node 24 的 fetch/http/https 读取代理环境；
- `NO_PROXY`，默认绕过 localhost、DSH 自身与 sidecar。

代理端口不会映射到宿主机公网。

## 常用命令

添加 HTTP / HTTPS / SOCKS 上游：

```bash
dshd proxy add hk01 http://user:password@proxy.example.com:8080
dshd proxy add jp01 socks5://127.0.0.1:1080
dshd proxy list
dshd proxy use hk01
dshd proxy enable
dshd proxy test
```

关闭并恢复直连：

```bash
dshd proxy disable
```

查看状态和日志：

```bash
dshd proxy status
dshd proxy logs
```

## VLESS / Trojan / Shadowsocks / Hysteria2 等

第一阶段不在 Bash 内重复实现各协议的分享链接解析器。对 sing-box 原生协议，直接添加一个 outbound JSON；该对象必须使用 `"tag": "proxy"`。

例如 Hysteria2：

```json
{
  "type": "hysteria2",
  "tag": "proxy",
  "server": "example.com",
  "server_port": 443,
  "password": "replace-me",
  "tls": {
    "enabled": true,
    "server_name": "example.com"
  }
}
```

保存成文件后：

```bash
dshd proxy add-json hy2 /root/hy2.json
dshd proxy use hy2
dshd proxy enable
```

也可以把单行 JSON 直接作为第三个参数，或用 `-` 从标准输入读取。

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
