#!/usr/bin/env bash
# DeepSeek Harness Docker Manager bootstrap
set -Eeuo pipefail

REPO="PaiMonCai/dsh-docker-install"
RAW_URL="https://raw.githubusercontent.com/${REPO}/main/dshd"
JSDELIVR_URL="https://cdn.jsdelivr.net/gh/${REPO}@main/dshd"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# Optional independent Reverse installer; Standard remains the default.
INSTALL_ACTION=install
if [[ "${1:-}" == reverse || "${1:-}" == reverse-install ]]; then
  INSTALL_ACTION=reverse
  shift
  set -- install "$@"
fi
# Only reuse a sibling manager when this installer was executed from a real
# file. When piped to "bash", BASH_SOURCE may be "main"; treating the current
# directory as the script directory can accidentally launch an unrelated or
# outdated ./dshd instead of downloading the current release.
SCRIPT_DIR=""
SOURCE="${BASH_SOURCE[0]:-}"
case "$SOURCE" in
  ''|main|/dev/fd/*|/proc/self/fd/*) ;;
  *)
    if [[ -f "$SOURCE" ]]; then
      SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" 2>/dev/null && pwd || true)"
    fi
    ;;
esac

# A readable /dev/tty device does not imply this process has a controlling
# terminal. In CI, container consoles and noninteractive SSH sessions, -r may
# return true even when redirecting stdin from /dev/tty fails with ENXIO.
has_controlling_tty() { ( : </dev/tty ) 2>/dev/null; }

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/dshd" ]]; then
  if has_controlling_tty; then
    exec bash "$SCRIPT_DIR/dshd" "$INSTALL_ACTION" "$@" </dev/tty
  else
    exec bash "$SCRIPT_DIR/dshd" "$INSTALL_ACTION" "$@"
  fi
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

download() {
  local url="$1"
  # 由 shell 负责写入：curl/wget 只输出到 stdout，避免各平台对临时路径解析的差异。
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 8 --max-time 30 "$url" >"$TMP"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=30 -O - "$url" >"$TMP"
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
if has_controlling_tty; then
  exec bash "$TMP" "$INSTALL_ACTION" "$@" </dev/tty
else
  exec bash "$TMP" "$INSTALL_ACTION" "$@"
fi
