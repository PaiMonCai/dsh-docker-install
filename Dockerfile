# syntax=docker/dockerfile:1
#
# DeepSeek Harness (dsh) 自定义镜像：Web GUI / headless / SDK / ACP 多模式，
# 内置 Chromium 浏览器，构建期自动检测国内网络并切换镜像源。
#
#   docker build -t dsh:latest .
#   docker run -d --name dsh \
#     -p 127.0.0.1:3080:3080 \
#     -e DEEPSEEK_API_KEY=sk-... \
#     -v dsh-home:/root/.dsh \
#     -v "$PWD:/workspace" \
#     dsh:latest
#
# 启动后从 `docker logs dsh` 里取带 token 的地址（形如
# dsh web: http://127.0.0.1:3080/?token=...），首次访问必须带上它。

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE}

# 上游发布版本；升级镜像时只改这里（check-update 工作流会自动维护）。
ARG DSH_VERSION=0.1.5-rc.2
# `dsh plugin add/remove` 会转发给 pnpm，所以顺带装上。
ARG PNPM_VERSION=10

# IN_CHINA=auto 自动检测国内网络并切换镜像源；yes/no 可强制指定。
# 有真实 HTTP 代理时直接传 --build-arg HTTPS_PROXY=http://proxy:7890。
ARG IN_CHINA=auto
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV IN_CHINA=${IN_CHINA}

LABEL org.opencontainers.image.title="DeepSeek Harness (dsh)" \
      org.opencontainers.image.description="DeepSeek Harness Web GUI, headless, SDK and ACP profiles in one image, with bundled Chromium" \
      org.opencontainers.image.source="https://github.com/deepseek-ai/deepseek-harness" \
      org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive \
    DSH_HOME=/root/.dsh \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY docker/cn-mirror.sh /usr/local/bin/cn-mirror

# bash    → dsh 的默认终端 shell（/bin/bash）
# git     → 仓库相关功能与 git 形式的插件安装
# curl    → HEALTHCHECK / 排查（cn-mirror 的探测也用它）
# tini    → PID 1，正确处理信号（docker stop）
# bubblewrap → Linux 沙箱后端候选之一（另一个是内核 Landlock，已随 npm 包内置）
# procps/less → 让模型在 shell 里的常见命令可用
RUN chmod +x /usr/local/bin/cn-mirror \
 && . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      echo "==> China network detected, switching apt sources to mirrors.aliyun.com"; \
      sed -i \
        -e 's|deb\.debian\.org/debian-security|mirrors.aliyun.com/debian-security|g' \
        -e 's|deb\.debian\.org/debian|mirrors.aliyun.com/debian|g' \
        /etc/apt/sources.list.d/debian.sources; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      bash \
      bubblewrap \
      ca-certificates \
      curl \
      git \
      less \
      procps \
      tini \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'

# 全局安装 dsh 本体（自带构建好的 Web 前端产物）、pnpm、Playwright Chromium。
# 国内网络：npm registry 切 npmmirror（全局生效，运行时安装插件同样受益），
# Playwright 浏览器二进制走 npmmirror CDN。
# npm 11.19+ 默认拦截依赖的 install/postinstall 脚本，这里会打印几行
# `npm warn install-scripts` 提示。已实测 koffi / node-pty / protobufjs /
# @deepseek-ai/dsh-subprocess-local 四个包在拦截状态下仍可正常 require：
# 平台二进制都随 tarball 发布。放开它们反而可能在 slim 镜像里触发 node-gyp 源码编译。
RUN . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      echo "==> China network detected, switching npm/playwright to npmmirror.com"; \
      npm config set registry https://registry.npmmirror.com --global; \
      export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright; \
    fi \
 && npm install --global --no-audit --no-fund \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      "pnpm@${PNPM_VERSION}" \
      playwright \
 && npx playwright install --with-deps chromium \
 && ln -sf "$(find "${PLAYWRIGHT_BROWSERS_PATH}" -type f -name chrome -path '*chrome-linux*' | head -1)" /usr/local/bin/chromium \
 && npm cache clean --force \
 && dsh --version \
 && chromium --version

# 容器内 bind host 叠加层：CLI 拒绝 --host 0.0.0.0，改用官方 patch 层打开。
COPY docker/dsh-bind.patch.yml /opt/dsh/dsh-bind.patch.yml
COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint

# 供浏览器类工具/插件引用内置 Chromium。
ENV CHROME_BIN=/usr/local/bin/chromium \
    CHROMIUM_PATH=/usr/local/bin/chromium

# 调用目录就是默认 workspace 根；把它做成挂载点。
WORKDIR /workspace

# 持久化 $DSH_HOME：profiles / sessions / credentials / settings 都在这里。
VOLUME ["/root/.dsh"]

EXPOSE 3080

# 未带 token 的 GET / 会返回 401，带 token 的首次访问是 302 + cookie，故两者都算健康。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DSH_PORT:-3080}/" | grep -qE '^(200|302|401)$'

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dsh-entrypoint"]
CMD ["web"]
