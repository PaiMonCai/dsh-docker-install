#!/usr/bin/env bash
# 覆盖 dshd 交互菜单的错误边界与输入回路：
#   1) 菜单里任一操作失败后必须回到菜单，而不是结束整个脚本
#   2) 输入非法时重问，而不是退出并丢弃已填内容
#   3) 镜像拉取失败时，用户填写的配置已经落盘
#   4) 输入流结束（EOF）不会死循环
#   5) 配置文件损坏时菜单仍可启动并可自愈
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export DSHD_LIB_ONLY=1
export DSHD_STATE_DIR="$TMP/state"
export DSHD_CONFIG_FILE="$TMP/state/config.env"
export DSHD_CONTAINER_ENV_FILE="$TMP/state/container.env"
export DSHD_BACKUP_DIR="$TMP/state/backups"
export DSHD_MOUNTS_FILE="$TMP/state/mounts.conf"
export DSHD_NO_SELF_UPDATE=1

mkdir -p "$DSHD_STATE_DIR"

source "$ROOT/dshd"

# 先按默认值把配置变量补齐（save_config 依赖它们），再打桩。
load_config

FORCED_TTY=0
is_tty() { [[ "$FORCED_TTY" == "1" ]]; }
ensure_docker() { return 0; }
docker_cmd() { return 1; }          # 模拟：docker 不可用 / 镜像拉取失败
container_exists() { return 1; }
container_running() { return 1; }

# --- 1) 菜单动作失败后回到菜单，并继续处理后续输入 -------------------------------
DSH_NAME=dsh
DSH_PORT=3080
set +e
printf '6\n\n2\n0\n' | menu >/dev/null 2>"$TMP/menu.err"
menu_rc=$?
set -e
[[ "$menu_rc" -eq 0 ]] || { echo "菜单应正常退出(0)，实际 $menu_rc"; cat "$TMP/menu.err"; exit 1; }
grep -q '本次操作未完成' "$TMP/menu.err" || { echo "应提示操作未完成并返回菜单"; cat "$TMP/menu.err"; exit 1; }

# --- 2) 修改配置：端口输错后重问，正确值被保存 -----------------------------------
FORCED_TTY=1
DSH_NAME=dsh-test
DSH_PORT=3080
DSH_BIND_ADDR=127.0.0.1
DSH_WORKSPACE="$TMP/workspace"
DSH_STORAGE_MODE=bind
DSH_DATA_DIR="$TMP/data"
DSH_VOLUME=dsh-test-home
DSH_SHM_SIZE=1g
DSH_TIMEZONE=Asia/Shanghai
DSH_NPM_CACHE=/tmp/npm-cache
DSH_MEMORY_LIMIT=""
DSH_MEMORY_SWAP=""
DSH_TRUSTED_HOSTS=""
DSHW_ADMIN_HOSTS=""
DEEPSEEK_BASE_URL=""
DEEPSEEK_API_KEY=""
DSH_DOCKER_ACCESS=false
DSH_EDITION=standard
DSH_RESEARCH_PACK=none
DSH_IMAGE=test-image

save_config
set +e
# 容器名回车保留 / 端口先输错再输对 / 其余全部回车保留
{
  printf '\nnot-a-port\n9090\n'
  for _ in $(seq 1 20); do printf '\n'; done
} | cmd_config >"$TMP/config.out" 2>&1
config_rc=$?
set -e
[[ "$config_rc" -eq 0 ]] || { echo "cmd_config 应在重试后成功，实际 $config_rc"; cat "$TMP/config.out"; exit 1; }
grep -q '请输入 1-65535 之间的端口' "$TMP/config.out" || { echo "端口非法时应重问"; cat "$TMP/config.out"; exit 1; }
load_config
[[ "$DSH_PORT" == "9090" ]] || { echo "端口应被保存为 9090，实际 $DSH_PORT"; exit 1; }

# --- 3) 输入流结束：不进入死循环，并放弃本次修改 ---------------------------------
DSH_PORT=3080
save_config
set +e
printf '\n' | timeout 10 bash -c '
  export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
  export DSHD_STATE_DIR="'"$DSHD_STATE_DIR"'"
  export DSHD_CONFIG_FILE="'"$DSHD_CONFIG_FILE"'"
  export DSHD_MOUNTS_FILE="'"$DSHD_MOUNTS_FILE"'"
  export DSHD_BACKUP_DIR="'"$DSHD_BACKUP_DIR"'"
  source "'"$ROOT"'/dshd"
  is_tty() { return 0; }
  ensure_docker() { return 0; }
  docker_cmd() { return 1; }
  set +e
  # 非法值 -> 重问 -> 输入流结束 -> 返回 1（而不是死循环，也不会采用非法值）
  printf "bad-port\n" | prompt_validated DSH_PORT "宿主机端口" 3080 validate_port "端口不合法。"
  echo "rc=$?"
' >"$TMP/eof.out" 2>&1
eof_rc=$?
set -e
[[ "$eof_rc" -eq 0 ]] || { echo "EOF 处理不应超时/挂死，实际 $eof_rc"; cat "$TMP/eof.out"; exit 1; }
grep -q 'rc=1' "$TMP/eof.out" || { echo "EOF 应返回 1 而不是死循环"; cat "$TMP/eof.out"; exit 1; }

# --- 4) 镜像拉取失败时，用户输入已经保存 -----------------------------------------
rm -f "$DSHD_CONFIG_FILE"
set +e
{
  # 版本=1 / 容器名 / 端口 / 目录类与资源类全部回车保留 / API 官方 / Key 留空 / 不开 Docker 管理
  printf '1\nc1\n3080\n'
  for _ in $(seq 1 11); do printf '\n'; done
  printf '1\n\nn\n'
} | timeout 30 bash -c '
  export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
  export DSHD_STATE_DIR="'"$DSHD_STATE_DIR"'"
  export DSHD_CONFIG_FILE="'"$DSHD_CONFIG_FILE"'"
  export DSHD_MOUNTS_FILE="'"$DSHD_MOUNTS_FILE"'"
  export DSHD_BACKUP_DIR="'"$DSHD_BACKUP_DIR"'"
  source "'"$ROOT"'/dshd"
  is_tty() { return 0; }
  detect_os() { OS_PRETTY=test; }
  network_report() { :; }
  ensure_docker() { return 0; }
  docker_cmd() { return 1; }
  install_self() { :; }
  create_container() { :; }
  set +e
  cmd_install
  echo "rc=$?"
' >"$TMP/install.out" 2>&1
install_rc=$?
set -e
[[ "$install_rc" -eq 0 ]] || { echo "安装流程不应挂死，实际 $install_rc"; cat "$TMP/install.out"; exit 1; }
[[ -s "$DSHD_CONFIG_FILE" ]] || { echo "镜像拉取失败前必须已保存用户配置"; cat "$TMP/install.out"; exit 1; }
grep -q '^DSH_NAME=' "$DSHD_CONFIG_FILE" || { echo "配置内容不完整"; cat "$DSHD_CONFIG_FILE"; exit 1; }

# --- 5) 配置文件损坏：菜单不崩溃，非交互下给出清晰错误 ---------------------------
printf 'DSH_STORAGE_MODE=bind\nDSH_DATA_DIR=relative/path\n' >"$DSHD_CONFIG_FILE"
FORCED_TTY=0
set +e
load_config_guarded >/dev/null 2>"$TMP/bad.out"
bad_rc=$?
set -e
[[ "$bad_rc" -ne 0 ]] || { echo "损坏配置应返回非 0"; cat "$TMP/bad.out"; exit 1; }
grep -q '配置文件内容无效' "$TMP/bad.out" || { echo "应明确指出配置文件无效"; cat "$TMP/bad.out"; exit 1; }

# 交互模式下应提供“备份并重置”
FORCED_TTY=1
set +e
printf 'y\n' | load_config_guarded >/dev/null 2>&1
reset_rc=$?
set -e
[[ "$reset_rc" -eq 0 ]] || { echo "重置后应能继续加载默认配置，实际 $reset_rc"; exit 1; }
[[ ! -f "$DSHD_CONFIG_FILE" ]] || { echo "重置后应移走损坏的配置文件"; exit 1; }
ls "$DSHD_CONFIG_FILE".invalid.* >/dev/null 2>&1 || { echo "应保留损坏配置的备份"; exit 1; }

# --- 6) 菜单里 Ctrl-C 只取消当前操作，不会结束整个管理器 -------------------------
timeout 60 bash -c '
  export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
  export DSHD_STATE_DIR="'"$TMP"'/ctrlc"
  export DSHD_CONFIG_FILE="$DSHD_STATE_DIR/config.env"
  export DSHD_MOUNTS_FILE="$DSHD_STATE_DIR/mounts.conf"
  export DSHD_BACKUP_DIR="$DSHD_STATE_DIR/backups"
  source "'"$ROOT"'/dshd"
  ensure_docker() { return 0; }
  container_exists() { return 0; }
  container_running() { return 1; }
  # docker logs -f 被打断：SIGINT 命中脚本自身
  docker_cmd() {
    case "$1" in
      logs) kill -INT $$; sleep 2; return 130 ;;
      *) return 1 ;;
    esac
  }
  set +e
  menu
' >"$TMP/ctrlc.out" 2>&1 <<<"$(printf '6\n\n\n\n\n\n0\n')" || true
grep -q '已取消当前操作' "$TMP/ctrlc.out" || { echo "Ctrl-C 应提示已取消当前操作"; cat "$TMP/ctrlc.out"; exit 1; }
[[ "$(grep -c 'DeepSeek Harness Docker Manager' "$TMP/ctrlc.out")" -ge 2 ]] \
  || { echo "Ctrl-C 之后应重新回到菜单"; cat "$TMP/ctrlc.out"; exit 1; }

printf 'test-dshd-interactive: ok\n'
