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

run_web() {
    local args=(web --patch "$BIND_PATCH" --no-open)

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

    log "启动 Web GUI（DSH_HOME=$DSH_HOME, bind=${DSH_BIND_HOST:-0.0.0.0}, workspace=$(pwd)）"
    exec dsh "${args[@]}" "$@"
}

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
