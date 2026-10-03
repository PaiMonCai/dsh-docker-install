#!/usr/bin/env bash
# 组装一次镜像发布要用的完整 tag 列表。
#
# 与上游 npm dist-tag 通道对齐：哪个通道（alpha / next / latest …）当前指向本次
# 构建的 dsh 版本，就给镜像补上同名 tag，使
#
#   docker pull <image>:alpha   ≈   npm i @deepseek-ai/dsh@alpha
#
# `<image>:latest` 始终代表"最新一次构建"（其对外语义由 build 工作流决定）。
# 本脚本负责补齐通道 tag、按需加前缀、去重，把结果以"一行一个完整镜像引用"写到
# stdout；带 --channels-only 时改为只输出通道名。
#
# 注意：名为 latest 的通道不单独打 tag —— 该含义由浮动 tag（标准镜像 :latest、
# 研究镜像 :research / :research-economics）承担，避免 :research-latest 被误读成
# "最新研究镜像"。
#
# 用法: ci/image-tags.sh [选项] <image> <version> [channels]
#       ci/image-tags.sh --channels-only <version> [channels]
#   <image>     不带 tag 的镜像名，如 ghcr.io/paimoncai/dsh-docker-install
#   <version>   本次构建的 dsh 版本，如 0.2.1-alpha.1
#   [channels]  逗号分隔的通道名；留空则按上游 npm dist-tag 自动推导
#
# 选项:
#   --prefix <p>     给版本号与通道 tag 加前缀（研究镜像用）：
#                    --prefix research- ⇒ research-0.2.1-alpha.1、research-alpha
#   --no-latest      不输出 <image>:latest（研究镜像用浮动的 :research / :research-economics）
#   --channels-only  只输出解析到的通道名（逗号分隔一行），供上游工作流转发给下游
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

usage() {
  {
    printf '用法: %s [选项] <image> <version> [channels]\n' "${0##*/}"
    printf '      %s --channels-only <version> [channels]\n' "${0##*/}"
    printf '选项: --prefix <p> | --no-latest | --channels-only\n'
  } >&2
}
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

# 把"每行一个通道名"折叠成逗号分隔的一行。
join_channels() {
  awk 'NF { printf "%s%s", sep, $0; sep="," } END { if (sep != "") printf "\n" }'
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

# 解析本次要用的通道：$1=version，$2=调用方给的通道（可空）。输出逗号分隔一行。
resolve_channels() {
  local version="$1" raw="$2" resolved=""
  if [[ -z "$raw" ]]; then
    raw="$(detect_channels "$version")"
    if [[ -n "${raw//[[:space:]]/}" ]]; then
      info "上游 dist-tag 指向 $version 的通道: $(printf '%s' "$raw" | tr '\n' ' ')"
    else
      info "上游没有 dist-tag 指向 $version，只发布版本号与浮动 tag。"
    fi
  fi
  resolved="$(normalize_channels "$raw" | join_channels)"
  printf '%s\n' "$resolved"
}

main() {
  local image="" version="" channels="" prefix="" resolved="" emit_latest=1 channels_only=0
  local -a positional=()

  while (( $# > 0 )); do
    case "$1" in
      --prefix)
        (( $# >= 2 )) || usage_err "--prefix 缺少参数"
        prefix="$2"; shift 2 ;;
      --prefix=*) prefix="${1#*=}"; shift ;;
      --no-latest) emit_latest=0; shift ;;
      --channels-only) channels_only=1; shift ;;
      -h|--help) usage; return 0 ;;
      --) shift; positional+=("$@"); break ;;
      -*) usage_err "未知选项: $1" ;;
      *) positional+=("$1"); shift ;;
    esac
  done

  if (( channels_only )); then
    (( ${#positional[@]} >= 1 )) || usage_err "--channels-only 需要 <version>"
    (( ${#positional[@]} <= 2 )) || usage_err "--channels-only 只接受 <version> [channels]"
    version="${positional[0]}"
    channels="${positional[1]:-}"
    [[ "$version" =~ $TAG_PATTERN ]] \
      || die "dsh 版本 $version 不能作为镜像 tag（OCI tag 只允许 [A-Za-z0-9_.-]，且需以字母/数字/下划线开头）"
    resolve_channels "$version" "$channels"
    return 0
  fi

  (( ${#positional[@]} >= 2 )) || usage_err "缺少参数"
  (( ${#positional[@]} <= 3 )) || usage_err "参数过多: 期望 <image> <version> [channels]"
  image="${positional[0]}"
  version="${positional[1]}"
  channels="${positional[2]:-}"

  [[ "$image" != *[[:space:]]* ]] || usage_err "镜像名不能包含空白: $image"
  [[ "${image##*/}" != *:* ]] || usage_err "第一个参数应为不带 tag 的镜像名: $image"
  # 校验"前缀+版本号"整体，前缀不合法（如含 / 或前导 -）会在这里暴露。
  [[ "${prefix}${version}" =~ $TAG_PATTERN ]] \
    || die "dsh 版本 ${prefix}${version} 不能作为镜像 tag（OCI tag 只允许 [A-Za-z0-9_.-]，且需以字母/数字/下划线开头）"

  resolved="$(resolve_channels "$version" "$channels")"

  {
    printf '%s:%s\n' "$image" "${prefix}${version}"
    # :latest 不加前缀：它是与通道无关的浮动 tag，研究镜像用 :research 代替。
    if (( emit_latest )); then
      printf '%s:latest\n' "$image"
    fi
    # 名为 latest 的通道不单独打 tag：浮动 tag（标准镜像 :latest、研究镜像 :research）
    # 已表达该含义，否则 :research-latest 会被误读成"最新研究镜像"。
    # --channels-only 仍如实上报该通道，供下游自行判断。
    normalize_channels "$resolved" \
      | awk -v p="$prefix" -v image="$image" '$0 != "latest" { print image ":" p $0 }'
  } | awk 'NF && !seen[$0]++'
}

main "$@"
