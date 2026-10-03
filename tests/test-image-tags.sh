#!/usr/bin/env bash
# ci/image-tags.sh 离线测试：验证上游 dist-tag 通道 tag 的推导、覆盖与去重。
# 全部用例使用本地夹具 JSON 或不可达地址，不依赖网络。
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/ci/image-tags.sh"
IMAGE="ghcr.io/paimoncai/dsh-docker-install"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { printf '[x] %s\n' "$*" >&2; exit 1; }

# 与上游当前形态一致的夹具：alpha 通道领先，latest/next 停在 rc。
cat >"$TMP/registry.json" <<'JSON'
{
  "dist-tags": { "alpha": "0.2.1-alpha.1", "next": "0.2.0-rc.2", "latest": "0.2.0-rc.2" },
  "versions": { "0.2.1-alpha.1": {}, "0.2.0-rc.2": {}, "0.1.7-rc.2": {} }
}
JSON

printf '{"dist-tags":' >"$TMP/broken.json"

DSH_REGISTRY_JSON="$TMP/registry.json"
export DSH_REGISTRY_JSON

# check <name> <expected tags> <args...>
check() {
  local name="$1" expected="$2"
  shift 2
  local actual status=0
  actual="$(bash "$SCRIPT" "$@" 2>"$TMP/stderr")" || status=$?
  if [[ "$status" != 0 ]]; then
    printf '[x] %s: 期望退出码 0，实际 %s\n' "$name" "$status" >&2
    sed 's/^/    stderr: /' "$TMP/stderr" >&2
    exit 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    printf '[x] %s: tag 列表不符\n--- 期望 ---\n%s\n--- 实际 ---\n%s\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'ok  %s\n' "$name"
}

# check_fails <name> <expected exit code> <args...>
check_fails() {
  local name="$1" want="$2"
  shift 2
  local status=0
  bash "$SCRIPT" "$@" >/dev/null 2>&1 || status=$?
  [[ "$status" == "$want" ]] || fail "$name: 期望退出码 $want，实际 $status"
  printf 'ok  %s\n' "$name"
}

# 1. 版本正被上游 alpha 通道指向 -> 追加 :alpha
check "alpha channel" \
"$IMAGE:0.2.1-alpha.1
$IMAGE:latest
$IMAGE:alpha" \
"$IMAGE" "0.2.1-alpha.1"

# 2. 版本同时被 next / latest 指向 -> :latest 去重，只追加 :next
check "next/latest dedupe" \
"$IMAGE:0.2.0-rc.2
$IMAGE:latest
$IMAGE:next" \
"$IMAGE" "0.2.0-rc.2"

# 3. 没有任何通道指向该版本 -> 只有版本号与 latest
check "no matching channel" \
"$IMAGE:0.1.7-rc.2
$IMAGE:latest" \
"$IMAGE" "0.1.7-rc.2"

# 4. 显式通道覆盖 registry 结果，并做 trim / dedupe
check "explicit channels override" \
"$IMAGE:0.1.7-rc.2
$IMAGE:latest
$IMAGE:alpha
$IMAGE:next" \
"$IMAGE" "0.1.7-rc.2" " alpha, next ,alpha"

# 5. 非法通道名被忽略，不影响其余 tag
check "invalid channel dropped" \
"$IMAGE:0.1.7-rc.2
$IMAGE:latest
$IMAGE:ok_1" \
"$IMAGE" "0.1.7-rc.2" "bad/tag,-lead,ok_1,with space"

# 6. 只有分隔符和空白 -> 等同于没有通道
check "blank channels" \
"$IMAGE:0.1.7-rc.2
$IMAGE:latest" \
"$IMAGE" "0.1.7-rc.2" " , , "

# 7. registry 元数据损坏 -> 降级为版本号 + latest，且不失败
DSH_REGISTRY_JSON="$TMP/broken.json"
export DSH_REGISTRY_JSON
check "broken registry json degrades" \
"$IMAGE:0.2.1-alpha.1
$IMAGE:latest" \
"$IMAGE" "0.2.1-alpha.1"

# 8. 夹具文件缺失 -> 同样降级
DSH_REGISTRY_JSON="$TMP/missing.json"
export DSH_REGISTRY_JSON
check "missing registry file degrades" \
"$IMAGE:0.2.0-rc.2
$IMAGE:latest" \
"$IMAGE" "0.2.0-rc.2"

# 9. 网络不可达 -> 同样降级，不阻断构建
unset DSH_REGISTRY_JSON
export DSH_REGISTRY_URL="http://127.0.0.1:9/@deepseek-ai/dsh"
check "unreachable registry degrades" \
"$IMAGE:0.2.0-rc.2
$IMAGE:latest" \
"$IMAGE" "0.2.0-rc.2"

# 10. 端口形式的镜像名（registry:port/owner/repo）仍然合法
check "registry with port" \
"localhost:5000/dsh:0.1.7-rc.2
localhost:5000/dsh:latest" \
"localhost:5000/dsh" "0.1.7-rc.2"

# 11. 参数与版本号校验
check_fails "missing args" 2
check_fails "missing version" 2 "$IMAGE"
check_fails "image with tag rejected" 2 "$IMAGE:latest" "0.2.1-alpha.1"
check_fails "version with build metadata rejected" 1 "$IMAGE" "0.2.1+build.1"
check_fails "version with slash rejected" 1 "$IMAGE" "0.2.1/evil"

echo "image tag channel checks passed"
