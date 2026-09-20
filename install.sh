#!/usr/bin/env bash
# DeepSeek Harness Docker Manager bootstrap
set -Eeuo pipefail

REPO="PaiMonCai/dsh-docker-install"
RAW_URL="https://raw.githubusercontent.com/${REPO}/main/dshd"
JSDELIVR_URL="https://cdn.jsdelivr.net/gh/${REPO}@main/dshd"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/dshd" ]]; then
  if [[ -r /dev/tty ]]; then
    exec bash "$SCRIPT_DIR/dshd" install "$@" </dev/tty
  else
    exec bash "$SCRIPT_DIR/dshd" install "$@"
  fi
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

download() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 8 --max-time 30 "$url" -o "$TMP"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=30 -O "$TMP" "$url"
  else
    return 127
  fi
}

info "下载 dshd 管理器..."
if download "$RAW_URL"; then
  :
elif download "$JSDELIVR_URL"; then
  info "GitHub Raw 不可用，已切换 jsDelivr。"
else
  die "无法下载 dshd。请先安装 curl/wget，或 git clone 仓库后执行 bash install.sh。"
fi

[[ -s "$TMP" ]] || die "下载到的 dshd 文件为空。"
chmod +x "$TMP"
if [[ -r /dev/tty ]]; then
  exec bash "$TMP" install "$@" </dev/tty
else
  exec bash "$TMP" install "$@"
fi
