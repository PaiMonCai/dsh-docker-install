#!/usr/bin/env bash
#
# DeepSeek Harness (dsh) 一键安装脚本
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/PaiMonCai/dsh-docker-install/main/install.sh | bash
#   # 或下载后运行：
#   chmod +x install.sh && ./install.sh
#
# 可用环境变量（均有默认值，非交互环境下用它们传参）：
#   DEEPSEEK_API_KEY   DeepSeek API 密钥（交互模式下留空会提示输入）
#   DSH_IMAGE          镜像地址（默认 ghcr.io/paimoncai/dsh-docker-install:latest，
#                      国内拉不动 ghcr 可换成镜像站，如 ghcr.nju.edu.cn/paimoncai/dsh-docker-install:latest）
#   DSH_NAME           容器名（默认 dsh）
#   DSH_PORT           宿主机端口（默认 3080）
#   DSH_BIND_ADDR      宿主机映射地址（默认 127.0.0.1；局域网访问用 0.0.0.0）
#   DSH_WORKSPACE      挂载给 agent 的工作目录（默认 ./workspace）
#   DSH_TRUSTED_HOSTS  域名/反代访问时的受信任 authority，逗号分隔
#
set -euo pipefail

IMAGE="${DSH_IMAGE:-ghcr.io/paimoncai/dsh-docker-install:latest}"
NAME="${DSH_NAME:-dsh}"
PORT="${DSH_PORT:-3080}"
BIND_ADDR="${DSH_BIND_ADDR:-127.0.0.1}"
WORKSPACE="${DSH_WORKSPACE:-$PWD/workspace}"
VOLUME="${DSH_VOLUME:-dsh-home}"
API_KEY="${DEEPSEEK_API_KEY:-}"
TRUSTED_HOSTS="${DSH_TRUSTED_HOSTS:-}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 检查 Docker ----------
command -v docker >/dev/null 2>&1 || die "未找到 docker，请先安装 Docker：https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行（或当前用户无权限）。Linux 可尝试：sudo systemctl start docker"

# ---------- 2. 交互式收集 API Key ----------
if [[ -z "$API_KEY" && -t 0 ]]; then
    read -r -p "请输入 DeepSeek API Key（留空则稍后到 Web UI 设置 → 模型 中填写）: " API_KEY || true
fi
[[ -z "$API_KEY" ]] && warn "未提供 DEEPSEEK_API_KEY，首次打开 Web UI 后需要手动配置模型。"

# ---------- 3. 拉取镜像 ----------
info "拉取镜像 $IMAGE ..."
docker pull "$IMAGE" || die "镜像拉取失败。国内网络可设置 DSH_IMAGE 走镜像站，例如：
  DSH_IMAGE=ghcr.nju.edu.cn/paimoncai/dsh-docker-install:latest bash install.sh"

# ---------- 4. 准备工作目录 ----------
mkdir -p "$WORKSPACE"

# ---------- 5. 清理同名旧容器 ----------
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    info "发现同名容器 $NAME，先停止并移除（数据在卷 $VOLUME 中，不受影响）"
    docker rm -f "$NAME" >/dev/null
fi

# ---------- 6. 启动 ----------
info "启动容器 $NAME（端口 ${BIND_ADDR}:${PORT}，工作区 ${WORKSPACE}）..."
docker run -d --name "$NAME" \
    --restart unless-stopped \
    -p "${BIND_ADDR}:${PORT}:3080" \
    -e DEEPSEEK_API_KEY="$API_KEY" \
    -e DSH_TRUSTED_HOSTS="$TRUSTED_HOSTS" \
    -v "${VOLUME}:/root/.dsh" \
    -v "${WORKSPACE}:/workspace" \
    "$IMAGE" >/dev/null

# ---------- 7. 等待启动并取 token ----------
info "等待 Web UI 就绪..."
URL=""
for _ in $(seq 1 45); do
    URL="$(docker logs "$NAME" 2>&1 | grep -oE 'http://[^ ]*\?token=[A-Za-z0-9_-]+' | tail -1 || true)"
    [[ -n "$URL" ]] && break
    docker ps --format '{{.Names}}' | grep -qx "$NAME" || die "容器已退出，日志如下：\n$(docker logs "$NAME" 2>&1 | tail -20)"
    sleep 1
done
[[ -z "$URL" ]] && die "等待超时，未在日志中找到访问地址。请执行 docker logs $NAME 排查。"

# 日志里的 host 是容器内视角，换成宿主机映射地址
ACCESS_URL="$(printf '%s' "$URL" | sed -E "s|http://[^/]+|http://${BIND_ADDR}:${PORT}|")"
[[ "$BIND_ADDR" == "0.0.0.0" ]] && ACCESS_URL="$(printf '%s' "$URL" | sed -E "s|http://[^/]+|http://127.0.0.1:${PORT}|")"

cat <<EOF

============================================================
 部署完成！

 在浏览器打开（首次访问必须带 token）：

   ${ACCESS_URL}

 token 校验通过后会种下 30 天 cookie，之后直接访问
 http://${BIND_ADDR}:${PORT} 即可。

 常用命令：
   docker logs -f ${NAME}     # 查看日志
   docker restart ${NAME}     # 重启
   docker rm -f ${NAME}       # 卸载（数据卷 ${VOLUME} 保留，
                              #  彻底删除加 docker volume rm ${VOLUME}）
============================================================
EOF
