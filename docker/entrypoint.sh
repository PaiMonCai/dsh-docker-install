#!/usr/bin/env bash
# DeepSeek Harness (dsh) 容器入口。
#
# 用法：
#   docker run <image>                      # 默认：启动 Web GUI
#   docker run <image> web --port 8080      # Web GUI + 透传 web app 参数
#   docker run <image> headless "跑一下测试"  # 一次性 headless 任务
#   docker run <image> dsh --dump-config    # 原样透传给 dsh
#   docker run <image> bash                 # 进容器排查
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/root/.dsh}"
mkdir -p "$DSH_HOME"

# 容器内 bind host 的叠加层（见 docker/dsh-bind.patch.yml）。
BIND_PATCH="${DSH_BIND_PATCH:-/opt/dsh/dsh-bind.patch.yml}"

log() { printf 'dsh-entrypoint: %s\n' "$*" >&2; }

# Plugin Hub 自己对 POST 做 localhost-only Origin 检查，和 DSH_TRUSTED_HOSTS 不一致。
# 对持久 profile 中已安装的 dsh-plugin 做幂等运行时 patch：外部 Host 必须同时满足
# Origin.host == Host 且存在于 DSH_TRUSTED_HOSTS。本地 localhost/127.0.0.1/::1 行为不变。
apply_dsh_market_container_restart_patch() {
    local patcher="/usr/local/bin/patch-dsh-market-container-restart.js"
    [[ -f "$patcher" ]] || return 0

    if node "$patcher"; then
        return 0
    fi

    # dsh-market changes quickly. A future upstream layout change must not make
    # the core DSH container unavailable; leave a clear warning and keep booting.
    log "警告：dsh-market Docker 重启适配补丁未能完整应用；插件安装后的“立即重启”可能仍需执行 dshd restart"
}

apply_plugin_hub_reverse_proxy_patch() {
    local patcher="/usr/local/bin/patch-plugin-hub-origin.js"
    [[ -f "$patcher" ]] || return 0

    if node "$patcher"; then
        return 0
    fi

    # 社区插件升级可能改变源码布局。不要因此阻止整个 DSH 启动，但必须明确告警，
    # dshd doctor 也会再次检查实际 server route 是否包含 Trusted Hosts patch。
    log "警告：Plugin Hub 反代 Origin patch 未能完整应用；通过域名执行插件安装等 POST 操作可能返回 403 untrusted origin"
}

# dsh 的 SessionHeader.cwd 会跨容器重建持久化，但旧版/历史会话可能记录 /root/dsh。
# 当前镜像的标准持久工作区是 /workspace；如果旧 cwd 随 overlay2 消失，Node spawn
# 会因为 cwd 不存在而统一报 ENOENT（bash / landlock-run / rg 看起来都会“起不来”）。
# session-persistence-jsonl 会按 projectKey(cwd) 分组，/root/dsh 对应 --root-dsh--，
# 因此无需改写不可变 SessionHeader，只在确有历史会话时补一个运行时软链接。
repair_stale_workspace_cwd() {
    local canonical="/workspace"
    local legacy="/root/dsh"
    local legacy_sessions="$DSH_HOME/sessions/--root-dsh--"

    [[ -d "$canonical" ]] || return 0
    [[ ! -e "$legacy" && ! -L "$legacy" ]] || return 0
    [[ -d "$legacy_sessions" ]] || return 0

    if ln -s "$canonical" "$legacy"; then
        log "检测到历史会话 cwd=$legacy 已失效，已自动修复：$legacy -> $canonical"
    else
        log "警告：检测到历史会话 cwd=$legacy 已失效，但自动修复失败"
    fi
}

# Built-in Web extensions ship with the image. They are mounted as DSH
# launcher patch layers directly from their absolute paths, like app glue.
# None invokes the external Profile Plugin Manager or pnpm.
prepare_native_web_plugins() {
    local migrator="/usr/local/bin/prepare-dsh-native-web-plugins.js"
    [[ -f "$migrator" ]] || { log "缺少内置插件迁移工具：$migrator"; return 1; }
    node "$migrator"
}

# The official DSH CLI accepts repeatable --patch overlays. All must be
# positioned BEFORE any Web-only argument such as --no-open or --port.
append_native_web_patch() {
    local file="$1" flag="$2" label="$3"
    local value="${flag,,}"
    case "$value" in
        1|true|yes|on|enabled)
            [[ -f "$file" ]] || { log "内置插件 $label 缺少补丁文件：$file"; return 1; }
            args+=(--patch "$file")
            ;;
        0|false|no|off|disabled) ;;
        *) log "内置插件 $label 的启用开关值无效：$flag"; return 1 ;;
    esac
}

apply_pending_session_deletions() {
    local reconciler="/usr/local/bin/apply-dsh-session-deletions"
    [[ -x "$reconciler" ]] || return 0
    if ! "$reconciler"; then
        log "警告：部分会话删除请求未应用。待处理队列将保留以供下次启动重试。"
    fi
}

run_web() {
    local args=(web --patch "$BIND_PATCH")

    # Upstream DSH forbids 0.0.0.0 from 0.2.1-alpha.2 onward. Resolve the
    # container's concrete network address so published Docker ports still work.
    # A user-provided DSH_BIND_HOST is validated by the same resolver.
    DSH_BIND_HOST="$(node /usr/local/bin/resolve-dsh-bind-host)"
    export DSH_BIND_HOST

    # Use the same secret across every restart/recreate. The file is inside
    # persistent DSH_HOME (0600), and is never passed through docker run -e.
    # A malformed/insecure token file must fail closed instead of falling
    # back to a fresh random per-process token.
    DSH_WEB_LOGIN_TOKEN="$(node /usr/local/bin/dsh-web-token.js print)"
    export DSH_WEB_LOGIN_TOKEN

    # Preflight all native extension overlays BEFORE modifying the persistent
    # Web Profile. DSH CLI launcher flags must precede Web app flags.
    [[ -f "$BIND_PATCH" ]] || { log "缺少 Web bind 补丁：$BIND_PATCH"; return 1; }
    append_native_web_patch "/opt/dsh/plugins/dsh-reasoning-editor/cordis.patch.yml" "${DSH_REASONING_EDITOR:-true}" "推理等级编辑器"
    append_native_web_patch "/opt/dsh/plugins/dsh-icon-dock/cordis.patch.yml" "${DSH_ICON_DOCK_ENABLED:-true}" "Icon Dock"
    append_native_web_patch "/opt/dsh/plugins/dsh-bili-ui-bridge/cordis.patch.yml" "${DSH_BILI_UI_BRIDGE:-true}" "billion-context 域名管理页"
    append_native_web_patch "/opt/dsh/plugins/dsh-session-manager-web/cordis.patch.yml" "${DSH_SESSION_MANAGER_WEB:-true}" "会话回收站"
    append_native_web_patch "/opt/dsh/plugins/dsh-web-search/cordis.patch.yml" "${DSH_SEARCH_ENABLED:-false}" "Web Search"
    # Reverse's image-owned, native Agent preset overlay. Not used by Standard.
    if [[ -n "${DSH_REVERSE_AGENT_PATCH:-}" ]]; then
        append_native_web_patch "${DSH_REVERSE_AGENT_PATCH}" "true" "Reverse Edition Agent"
    fi

    # Migrate only legacy bundled plugin selections; dependencies, third-party
    # selection and pnpm-lock.yaml stay untouched, with a manifest backup.
    prepare_native_web_plugins
    # Bundle upgrades are installed in DSH_HOME; make only the known native
    # billion-context UI use the authenticated DSH same-origin route.
    # A failed adapter leaves DSH usable but logs an explicit warning.
    if ! node /usr/local/bin/patch-bili-client-ui.js; then
        log "警告：billion-context 域名 UI 修复未生效；可查看插件安装版本或禁用 DSH_BILI_UI_BRIDGE"
    fi
    # No more launcher flags after here: --no-open, --port, and --trusted-host
    # all belong to the Web application rather than the top-level DSH CLI.
    args+=(--no-open)

    # DSH_PORT 是便捷写法；命令行里的 --port 由 "$@" 透传，二者同时给出时命令行在后。
    if [[ -n "${DSH_PORT:-}" ]]; then
        args+=(--port "$DSH_PORT")
    fi

    # DSH_TRUSTED_HOSTS="dsh.example.com,other:3080" → 逐个 --trusted-host。
    # 只通过 localhost / 127.0.0.1 访问时不需要它：回环 Host 永远受信任。
    if [[ -n "${DSH_TRUSTED_HOSTS:-}" ]]; then
        local hosts=() host
        IFS=', ' read -r -a hosts <<<"$DSH_TRUSTED_HOSTS" || true
        for host in "${hosts[@]}"; do
            [[ -n "$host" ]] && args+=(--trusted-host "$host")
        done
    fi

    log "启动 Web GUI（DSH_HOME=$DSH_HOME, bind=${DSH_BIND_HOST}, workspace=$(pwd)）"
    exec dsh "${args[@]}" "$@"
}

apply_pending_session_deletions
repair_stale_workspace_cwd
apply_plugin_hub_reverse_proxy_patch
apply_dsh_market_container_restart_patch

case "${1:-web}" in
    web)
        shift
        run_web "$@"
        ;;
    -*)
        # `docker run <image> --port 8080` 这类写法同样按 web app 参数处理。
        run_web "$@"
        ;;
    headless)
        shift
        exec dsh --profile headless "$@"
        ;;
    sdk | sdk-minimal | acp)
        mode="$1"
        shift
        exec dsh --profile "$mode" "$@"
        ;;
    dsh)
        shift
        exec dsh "$@"
        ;;
    plugin)
        shift
        exec dsh plugin "$@"
        ;;
    *)
        # bash / node / 任意命令：原样执行，方便调试与自定义编排。
        exec "$@"
        ;;
esac
