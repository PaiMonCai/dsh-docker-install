#!/usr/bin/env bash
# 构建期网络环境探测：判断当前是否在国内网络，以决定是否切换到国内镜像源。
#
# 用法：
#   . /usr/local/bin/cn-mirror   #  source 后调用 is_cn
#   cn-mirror check              # 直接检测，国内输出 yes 否则 no
#
# 通过构建参数 IN_CHINA=yes|no 可跳过自动检测（auto 为自动）。

is_cn() {
  case "${IN_CHINA:-auto}" in
    yes|true|1) return 0 ;;
    no|false|0) return 1 ;;
  esac
  # 能连通 Google 视为境外；否则能连通百度视为国内；都不通则按境外处理
  if curl -fsS --max-time 5 -o /dev/null https://www.google.com 2>/dev/null; then
    return 1
  elif curl -fsS --max-time 5 -o /dev/null https://www.baidu.com 2>/dev/null; then
    return 0
  fi
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if is_cn; then echo yes; else echo no; fi
fi
