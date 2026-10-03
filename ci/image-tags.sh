#!/usr/bin/env bash
# 组装一次镜像发布要用的完整 tag 列表。
#
# 与上游 npm dist-tag 通道对齐：哪个通道（alpha / next / latest …）当前指向本次
# 构建的 dsh 版本，就给镜像补上同名 tag，使
#
#   docker pull <image>:alpha   ≈   npm i @deepseek-ai/dsh@alpha
#
# `<image>:latest` 始终代表"最新一次构建"（其对外语义由 build 工作流决定），
# 本脚本只负责补齐通道 tag、去重，并把结果以"一行一个完整镜像引用"写到 stdout。
#
# 用法: ci/image-tags.sh <image> <version> [channels]
#   <image>     不带 tag 的镜像名，如 ghcr.io/paimoncai/dsh-docker-install
#   <version>   本次构建的 dsh 版本，如 0.2.1-alpha.1
#   [channels]  逗号分隔的通道名；留空则按上游 npm dist-tag 自动推导
#
# 环境变量:
#   DSH_REGISTRY_URL   覆盖 npm registry 元数据地址
#   DSH_REGISTRY_JSON  直接读取本地 JSON 文件（离线测试用），跳过网络
#
# 退出码: 0 正常（含无法查询上游时的降级）；2 参数非法；1 版本号不能作为 tag。

set -Eeuo pipefail

DEFAULT_REGISTRY_URL="https://registry.npmjs.org/@deepseek-ai/dsh"
REGISTRY_URL="${DSH_REGISTRY_URL:-$DEFAULT_REGISTRY_URL}"
# OCI 镜像 tag 的字符集（同样用于校验版本号与通道名）。
TAG_PATTERN='^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'

die() { printf '[x] %s\n' "$*" >&2; exit 1; }
warn() { printf '[!] %s\n' "$*" >&2; }
info() { printf '[i] %s\n' "$*" >&2; }

usage() { printf '用法: %s <image> <version> [channels]\n' "${0##*/}" >&2; }
usage_err() { usage; printf '[x] %s\n' "$*" >&2; exit 2; }

# 把逗号分隔的通道名规范化为"每行一个"：去空白、剔除不能作为 OCI tag 的名字。
normalize_channels() {
  local raw="$1" name
  while IFS= read -r name; do
    name="$(printf '%s' "$name" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [[ -n "$name" ]] || continue
    if [[ ! "$name" =~ $TAG_PATTERN ]]; then
      warn "忽略非法通道名（不能作为镜像 tag）: $name"
      continue
    fi
    printf '%s\n' "$name"
    # 结尾必须带换行：否则最后一行只有 EOF 没有分隔符，read 返回非 0 会丢掉这一轮。
  done < <(printf '%s\n' "$raw" | tr ',' '\n')
}

# 从上游 registry 元数据里找出所有指向 $version 的 dist-tag 名。
# 查询/解析失败时只告警并返回空，不阻断构建。
detect_channels() {
  local version="$1" payload="" json_file="${DSH_REGISTRY_JSON:-}" detected=""

  command -v node >/dev/null 2>&1 || {
    warn "缺少 node，无法解析上游 dist-tag，本次不追加通道 tag。"
    return 0
  }

  if [[ -n "$json_file" ]]; then
    [[ -r "$json_file" ]] || {
      warn "DSH_REGISTRY_JSON 不可读: $json_file，本次不追加通道 tag。"
      return 0
    }
    payload="$(cat -- "$json_file")"
  else
    command -v curl >/dev/null 2>&1 || {
      warn "缺少 curl，无法读取上游 dist-tag，本次不追加通道 tag。"
      return 0
    }
    if ! payload="$(curl -fsSL --connect-timeout 10 --max-time 30 "$REGISTRY_URL" 2>/dev/null)"; then
      warn "读取上游 dist-tag 失败: $REGISTRY_URL（本次不追加通道 tag）"
      return 0
    fi
  fi

  [[ -n "$payload" ]] || {
    warn "上游 registry 元数据为空，本次不追加通道 tag。"
    return 0
  }

  if ! detected="$(printf '%s' "$payload" | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      let meta;
      try { meta = JSON.parse(s); } catch (err) { process.exit(3); }
      const dist = (meta && meta["dist-tags"]) || {};
      for (const name of Object.keys(dist)) {
        if (dist[name] === process.argv[1]) console.log(name);
      }
    });
  ' "$version" 2>/dev/null)"; then
    warn "解析上游 dist-tag 失败（$REGISTRY_URL），本次不追加通道 tag。"
    return 0
  fi

  printf '%s\n' "$detected"
}

main() {
  local image="${1:-}" version="${2:-}" channels="${3:-}"

  [[ -n "$image" && -n "$version" ]] || usage_err "缺少参数"
  [[ "$image" != *[[:space:]]* ]] || usage_err "镜像名不能包含空白: $image"
  [[ "${image##*/}" != *:* ]] || usage_err "第一个参数应为不带 tag 的镜像名: $image"
  [[ "$version" =~ $TAG_PATTERN ]] \
    || die "dsh 版本 $version 不能作为镜像 tag（OCI tag 只允许 [A-Za-z0-9_.-]，且需以字母/数字/下划线开头）"

  if [[ -z "$channels" ]]; then
    channels="$(detect_channels "$version")"
    if [[ -n "${channels//[[:space:]]/}" ]]; then
      info "上游 dist-tag 指向 $version 的通道: $(printf '%s' "$channels" | tr '\n' ' ')"
    else
      info "上游没有 dist-tag 指向 $version，只发布版本号与 latest。"
    fi
  fi

  {
    printf '%s:%s\n' "$image" "$version"
    printf '%s:latest\n' "$image"
    # 通道 tag 与固定 tag 一起去掉重复项（例如 dist-tag 本身就叫 latest）。
    normalize_channels "$channels" | awk -v image="$image" '{ print image ":" $0 }'
  } | awk 'NF && !seen[$0]++'
}

main "$@"
