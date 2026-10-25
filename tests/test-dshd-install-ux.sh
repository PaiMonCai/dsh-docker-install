#!/usr/bin/env bash
# Exercise real wizard functions with disposable state and no Docker/network.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'printf "Installer UX failure at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1 DSHD_STATE_DIR="$tmp/state"
source "$ROOT/dshd"
load_config
is_tty() { return 0; }
ensure_docker() { :; }
detect_os() { OS_PRETTY=test; }
network_report() { :; }
container_exists() { return 1; }
port_in_use() { return 1; }
install_self() { :; }

(
  chosen=unchanged
  prompt_choice chosen Storage bind bind 'Host directory' volume 'Docker volume' <<< $'bad\n2' >"$tmp/choice"
  [[ "$chosen" == volume ]]
  prompt_choice chosen Bind 192.0.2.10 127.0.0.1 Local 0.0.0.0 Remote <<< '' >"$tmp/current"
  [[ "$chosen" == 192.0.2.10 ]]
  grep -Fq '保留当前值：192.0.2.10' "$tmp/current"
  if prompt_choice chosen Storage bind bind Host volume Volume </dev/null >"$tmp/eof" 2>&1; then exit 1; fi
  [[ "$chosen" == 192.0.2.10 && "$DSHD_INPUT_EOF" == 1 ]]
  is_tty() { return 1; }
  prompt_choice chosen Bind 192.0.2.10 127.0.0.1 Local >"$tmp/noninteractive"
  [[ "$chosen" == 192.0.2.10 && ! -s "$tmp/noninteractive" ]]
)

(
  confirm Proceed N <<< 1 >"$tmp/confirm"
  if confirm Proceed N <<< 2 >"$tmp/confirm"; then exit 1; fi
  confirm Proceed N <<< y >"$tmp/confirm"
  confirm Proceed Y <<< '' >"$tmp/confirm"
  if confirm Proceed N <<< '' >"$tmp/confirm"; then exit 1; fi
  if confirm Proceed Y <<< $'bad\n2' >"$tmp/confirm" 2>&1; then exit 1; fi
  if confirm Proceed Y </dev/null >"$tmp/confirm-eof" 2>&1; then exit 1; fi
  [[ "$DSHD_INPUT_EOF" == 1 ]]
)

(
  DEEPSEEK_API_KEY=installer-secret-fixture
  interactive_api_config edit <<< $'9\n2\ninvalid-url\nhttps://gateway.example/v1\n1' >"$tmp/api" 2>&1
  [[ "$DEEPSEEK_BASE_URL" == https://gateway.example/v1 && "$DEEPSEEK_API_KEY" == installer-secret-fixture ]]
  ! grep -Fq installer-secret-fixture "$tmp/api"
  interactive_api_config edit <<< $'1\n2\n' >"$tmp/key-empty"
  [[ -z "$DEEPSEEK_BASE_URL" && "$DEEPSEEK_API_KEY" == installer-secret-fixture ]]
  interactive_api_config edit <<< $'1\n3' >"$tmp/key-clear"
  [[ -z "$DEEPSEEK_API_KEY" ]]
)

(
  DSH_MEMORY_LIMIT=3g; DSH_MEMORY_SWAP=5g
  interactive_runtime_config <<< '' >"$tmp/keep-resources"
  [[ "$DSH_MEMORY_LIMIT" == 3g && "$DSH_MEMORY_SWAP" == 5g ]]
  interactive_runtime_config <<< $'2\n\n\n\n\n2\n3\n1g\n2' >"$tmp/resources" 2>&1
  [[ "$DSH_MEMORY_LIMIT" == 2g && "$DSH_MEMORY_SWAP" == 2g ]]
  grep -Fq '不能小于内存上限' "$tmp/resources"
  runtime_resources_valid
  DSH_MEMORY_SWAP=1g
  if runtime_resources_valid; then echo 'Invalid RAM+Swap accepted'; exit 1; fi
  interactive_runtime_config <<< $'2\n\n\n\n\n1' >"$tmp/unlimited"
  [[ -z "$DSH_MEMORY_LIMIT" && -z "$DSH_MEMORY_SWAP" ]]
  ! grep -Fq 'RAM+Swap 总上限' "$tmp/unlimited"
)

(
  # Go through the actual first-install wizard and persistence, not a fake child.
  STATE_DIR="$tmp/reverse"; CONFIG_FILE="$STATE_DIR/config.env"
  DSHD_REVERSE_MODE=1; DSH_EDITION=reverse
  DSH_NAME=dsh-reverse; DSH_PORT=3081; DSH_IMAGE="$REVERSE_IMAGE"
  DSH_WORKSPACE="$tmp/reverse-workspace"; DSH_DATA_DIR="$tmp/reverse-data"
  DSH_STORAGE_MODE=bind; DSH_VOLUME=custom-reverse-home
  DEEPSEEK_API_KEY=""; DEEPSEEK_BASE_URL=""
  pull_best_image() { return 1; }
  rc=0
  cmd_install <<< $'1\n\n1\n\n\n\n1\n\n2\n1' >"$tmp/reverse-install" 2>&1 || rc=$?
  [[ "$rc" == 1 && -s "$CONFIG_FILE" ]]
  source "$CONFIG_FILE"
  [[ "$DSH_WORKSPACE" == "$tmp/reverse-workspace" && "$DSH_DATA_DIR" == "$tmp/reverse-data" ]]
  [[ "$DSH_VOLUME" == custom-reverse-home && "$DSH_DOCKER_ACCESS" == false ]]
  grep -Fq '配置摘要' "$tmp/reverse-install"
  grep -Fq '保存并开始安装' "$tmp/reverse-install"
  configure_with_review() { :; }
  pull_best_image() { :; }
  web_prepare() { :; }
  create_container() { :; }
  cmd_install >"$tmp/reverse-complete" 2>&1
  grep -Fq 'dshd reverse menu' "$tmp/reverse-complete"
)

(
  STATE_DIR="$tmp/review"; CONFIG_FILE="$STATE_DIR/config.env"
  DSH_EDITION=standard; DSH_NAME=dsh-review; DSH_PORT=3080
  unset DSHD_REVERSE_MODE DSHD_INSTANCE_ID DSHD_INSTANCE_EDITION
  calls=0
  interactive_config() { calls=$((calls + 1)); DSH_NAME=dsh-review; DSH_PORT="$((9080 + calls))"; }
  pull_best_image() { printf 'pull\n' >>"$tmp/pulls"; return 1; }
  if cmd_install <<< $'1\n3' >"$tmp/cancel" 2>&1; then exit 1; fi
  [[ ! -f "$CONFIG_FILE" && ! -f "$tmp/pulls" ]]
  if cmd_install <<< 1 >"$tmp/review-eof" 2>&1; then exit 1; fi
  [[ ! -f "$CONFIG_FILE" && ! -f "$tmp/pulls" ]]
  calls=0
  if cmd_install <<< $'1\n2\n1' >"$tmp/edit-review" 2>&1; then exit 1; fi
  [[ "$calls" == 2 && -s "$CONFIG_FILE" ]]
  grep -Fxq 'DSH_PORT=9082' "$CONFIG_FILE"
  [[ "$(wc -l <"$tmp/pulls")" -eq 1 ]]
  cp "$CONFIG_FILE" "$tmp/before-cancel"
  if cmd_config <<< 3 >"$tmp/config-cancel" 2>&1; then exit 1; fi
  cmp "$tmp/before-cancel" "$CONFIG_FILE"
  DEEPSEEK_API_KEY=summary-secret-fixture
  show_config_summary >"$tmp/summary"
  ! grep -Fq summary-secret-fixture "$tmp/summary"
  grep -Fq 'Key 已配置' "$tmp/summary"
)

bash "$ROOT/install.sh" --help >"$tmp/bootstrap-help"
grep -Fq '序号安装向导' "$tmp/bootstrap-help"
if bash "$ROOT/install.sh" invalid >"$tmp/bootstrap-invalid" 2>&1; then exit 1; fi
grep -Fq '未知安装参数' "$tmp/bootstrap-invalid"

# A downloaded manager must remain readable while running and be removed on
# either success or failure, with its original exit status propagated.
mkdir -p "$tmp/bin"
cat >"$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
cat <<'MANAGER'
#!/usr/bin/env bash
[[ -f "${BASH_SOURCE[0]}" ]] || exit 99
printf '%s\n' "${BASH_SOURCE[0]}" >"$BOOTSTRAP_PATH_LOG"
exit "${BOOTSTRAP_EXIT_CODE:-0}"
MANAGER
MOCK
chmod +x "$tmp/bin/curl"
for expected_rc in 0 7; do
  actual_rc=0
  cat "$ROOT/install.sh" | env PATH="$tmp/bin:$PATH" \
    BOOTSTRAP_PATH_LOG="$tmp/downloaded-path" BOOTSTRAP_EXIT_CODE="$expected_rc" bash \
    >"$tmp/bootstrap-run" 2>&1 || actual_rc=$?
  [[ "$actual_rc" == "$expected_rc" ]]
  [[ ! -e "$(cat "$tmp/downloaded-path")" ]]
done

echo 'Installer numbered choices, isolated defaults, review and cancellation tests passed'
