# syntax=docker/dockerfile:1
# DeepSeek Harness (dsh) · Ubuntu 24.04 LTS (Noble)
# Node.js 24 / Python 3.12 / Go / Docker CLI / Playwright / embedded SearXNG

ARG UBUNTU_IMAGE=ubuntu:24.04

# All build stages use the same Ubuntu release and system Python ABI.
FROM ${UBUNTU_IMAGE} AS ubuntu-base
ARG IN_CHINA=auto
ENV IN_CHINA=${IN_CHINA} DEBIAN_FRONTEND=noninteractive
COPY docker/cn-mirror.sh /usr/local/bin/cn-mirror
# Ubuntu minimal images do not contain curl; bootstrap the mirror detector first.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      echo '==> China network detected, switching Ubuntu Noble apt sources'; \
      sed -i \
        -e 's|archive.ubuntu.com/ubuntu|mirrors.aliyun.com/ubuntu|g' \
        -e 's|security.ubuntu.com/ubuntu|mirrors.aliyun.com/ubuntu|g' \
        /etc/apt/sources.list.d/ubuntu.sources; \
    fi

# SearXNG builder and runtime use the SAME Ubuntu Python and glibc ABI.
FROM ubuntu-base AS searxng-builder
ARG SEARXNG_REF=ad46ebd7d87666edb5f116c5b274b47f689ac6cd
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 python3-dev python3-pip python3-venv build-essential \
      libxml2-dev libxslt1-dev libffi-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*
RUN git init /opt/dsh/searxng-src \
 && git -C /opt/dsh/searxng-src remote add origin https://github.com/searxng/searxng.git \
 && git -C /opt/dsh/searxng-src fetch --depth=1 origin "${SEARXNG_REF}" \
 && git -C /opt/dsh/searxng-src checkout --detach FETCH_HEAD \
 && python3 -m venv /opt/dsh/searxng-venv \
 && /opt/dsh/searxng-venv/bin/pip install --no-cache-dir -U pip setuptools wheel pyyaml msgspec typing-extensions pybind11 granian \
 && cd /opt/dsh/searxng-src \
 && /opt/dsh/searxng-venv/bin/pip install --no-cache-dir --use-pep517 --no-build-isolation -e . \
 && /opt/dsh/searxng-venv/bin/python -c 'import searx; import granian' \
 && install -d /etc/searxng \
 && if [ -f utils/templates/etc/searxng/limiter.toml ]; then \
      cp utils/templates/etc/searxng/limiter.toml /etc/searxng/limiter.toml; \
    else printf '# Limiter intentionally disabled for private instances\n' > /etc/searxng/limiter.toml; fi

FROM ubuntu-base

ARG DSH_VERSION=0.2.1-rc.2
ARG PNPM_VERSION=11.7.0
ARG GO_VERSION=1.27.1
ARG TARGETARCH
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG DOCKER_APT_BASE=https://download.docker.com/linux/ubuntu

LABEL org.opencontainers.image.title="DeepSeek Harness (dsh)" \
      org.opencontainers.image.description="Ubuntu 24.04 DSH development container with Node.js, Python, Go, Docker CLI and Chromium" \
      org.opencontainers.image.source="https://github.com/PaiMonCai/dsh-docker-install" \
      org.opencontainers.image.version="${DSH_VERSION}" \
      io.caicailo.dsh.version="${DSH_VERSION}" \
      io.caicailo.dsh.edition="standard" \
      org.opencontainers.image.licenses="MIT AND AGPL-3.0-or-later"

ENV DSH_HOME=/root/.dsh \
    DSH_WORKSPACE_ROOT=/workspace \
    TZ=Asia/Shanghai \
    NPM_CONFIG_PREFIX=/usr/local \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/go/bin:${PATH}

COPY docker/patch-remote-settings.js /usr/local/bin/patch-remote-settings.js
COPY docker/patch-connection-rpc-routes.js /usr/local/bin/patch-connection-rpc-routes.js
COPY docker/patch-web-launch-token.js /usr/local/bin/patch-web-launch-token.js
COPY docker/patch-workspace-picker-home.js /usr/local/bin/patch-workspace-picker-home.js
COPY docker/patch-plugin-hub-origin.js /usr/local/bin/patch-plugin-hub-origin.js
COPY docker/patch-dsh-market-container-restart.js /usr/local/bin/patch-dsh-market-container-restart.js

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash bubblewrap build-essential ca-certificates curl git gnupg \
      jq less openssh-client procps python3 python3-dev python3-pip \
      python3-venv tini tzdata unzip wget zip \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'

# Python 通用项目工具；国内构建时切清华 PyPI 镜像。
RUN . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      python3 -m pip install --break-system-packages --no-cache-dir \
        --index-url https://pypi.tuna.tsinghua.edu.cn/simple uv; \
    else \
      python3 -m pip install --break-system-packages --no-cache-dir uv; \
    fi \
 && python3 --version \
 && python3 -m pip --version \
 && uv --version

# Go 1.27.1（amd64/arm64），下载后校验官方 SHA256。
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) GO_SHA256="63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445" ;; \
      arm64) GO_SHA256="3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec" ;; \
      *) echo "Unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz" -o /tmp/go.tgz; \
    echo "${GO_SHA256}  /tmp/go.tgz" | sha256sum -c -; \
    rm -rf /usr/local/go; \
    tar -C /usr/local -xzf /tmp/go.tgz; \
    rm -f /tmp/go.tgz; \
    rm -rf \
      /usr/local/go/doc \
      /usr/local/go/test; \
    go version

# 只装 Docker 客户端。dshd 可选挂载宿主机 docker.sock，不在容器里运行 dockerd。
RUN set -eux; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL --retry 3 "${DOCKER_APT_BASE}/gpg" -o /etc/apt/keyrings/docker.asc; \
    chmod a+r /etc/apt/keyrings/docker.asc; \
    . /etc/os-release; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] ${DOCKER_APT_BASE} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      docker-ce-cli \
      docker-buildx-plugin \
      docker-compose-plugin; \
    rm -rf /var/lib/apt/lists/*; \
    docker --version; \
    docker buildx version; \
    docker compose version

# Ubuntu 24.04 does not ship Node.js 24 in its default archive.
# Install the NodeSource 24.x package using its signed apt repository, without
# executing an unaudited remote setup script. Keep npm's global prefix identical
# to the old official Node container so DSH CLI locations remain stable.
RUN set -eux; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL --retry 3 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    chmod a+r /etc/apt/keyrings/nodesource.gpg; \
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' \
      "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/nodesource.list; \
    printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' \
      > /etc/apt/preferences.d/nodejs; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    rm -rf /var/lib/apt/lists/*; \
    node --version | grep -q '^v24'; \
    npm --version; \
    test "$(npm prefix --global)" = "/usr/local"

# 与 dsh 0.1.5-rc.2 官方根项目的 packageManager 保持一致。pnpm 必须先于
# dsh/插件单独安装：不能把它们放进同一条 npm install，因为 npm 不保证
# 全局包的安装/生命周期顺序，可能用另一版 pnpm 生成 profile 的 node_modules。
RUN . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      echo "==> China network detected, switching npm to npmmirror.com"; \
      npm config set registry https://registry.npmmirror.com --global; \
    fi \
 && npm install --global --no-audit --no-fund \
      "pnpm@${PNPM_VERSION}" \
 && test "$(pnpm --version)" = "${PNPM_VERSION}" \
 && PNPM_MAJOR="${PNPM_VERSION%%.*}" \
 && pnpm store path | grep -q "/v${PNPM_MAJOR}$" \
 && rm -rf "${NPM_CONFIG_CACHE}"

RUN . /usr/local/bin/cn-mirror \
 && if is_cn; then \
      echo "==> China network detected, switching Playwright to npmmirror.com"; \
      export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright; \
    fi \
 && npm install --global --no-audit --no-fund \
      "@deepseek-ai/dsh@${DSH_VERSION}" \
      playwright \
 && node /usr/local/bin/patch-remote-settings.js \
 && node /usr/local/bin/patch-connection-rpc-routes.js \
 && node /usr/local/bin/patch-web-launch-token.js \
 && node /usr/local/bin/patch-workspace-picker-home.js \
 && npx playwright install --with-deps chromium \
 && ln -sf "$(find "${PLAYWRIGHT_BROWSERS_PATH}" -type f -name chrome -path '*chrome-linux*' | head -1)" /usr/local/bin/chromium \
 && dsh --version \
 && node --version \
 && test "$(pnpm --version)" = "${PNPM_VERSION}" \
 && pnpm store path \
 && chromium --version \
 && rm -rf "${NPM_CONFIG_CACHE}" /var/lib/apt/lists/* \
 && rm -f \
      /usr/local/bin/cn-mirror \
      /usr/local/bin/patch-remote-settings.js \
      /usr/local/bin/patch-connection-rpc-routes.js \
      /usr/local/bin/patch-web-launch-token.js \
      /usr/local/bin/patch-workspace-picker-home.js

# Bundled SearXNG: never runs until the Web Search provider is enabled.
# Source retains upstream AGPL-3.0-or-later license and attribution.
COPY --from=searxng-builder /opt/dsh/searxng-src /opt/dsh/searxng-src
COPY --from=searxng-builder /opt/dsh/searxng-venv /opt/dsh/searxng-venv
COPY --from=searxng-builder /etc/searxng/limiter.toml /etc/searxng/limiter.toml
# SearXNG runs as an unprivileged user even when DSH's host is root.
# Cache lives outside the persistent DSH_HOME credentials directory.
RUN groupadd --gid 62000 searxng \
 && useradd --no-create-home --uid 62000 --gid 62000 --home-dir /var/cache/searxng --shell /usr/sbin/nologin searxng \
 && install -d -m 0700 -o searxng -g searxng /var/cache/searxng
COPY docker/plugins/dsh-web-search/ /opt/dsh/plugins/dsh-web-search/
COPY docker/plugins/dsh-reasoning-editor/ /opt/dsh/plugins/dsh-reasoning-editor/
COPY docker/plugins/dsh-session-manager/dsh-session-manager /usr/local/bin/dsh-session-manager
COPY docker/plugins/dsh-icon-dock/ /opt/dsh/plugins/dsh-icon-dock/
COPY docker/plugins/dsh-session-manager-web/ /opt/dsh/plugins/dsh-session-manager-web/
COPY docker/plugins/dsh-instance-manager/ /opt/dsh/plugins/dsh-instance-manager/
COPY docker/plugins/dsh-prompt-manager/ /opt/dsh/plugins/dsh-prompt-manager/
COPY docker/plugins/dsh-context-manager/ /opt/dsh/plugins/dsh-context-manager/
RUN npm install --prefix /opt/dsh/plugins/dsh-context-manager --omit=dev --no-audit --no-fund
COPY docker/context-manager-tiered-preflight.mjs /opt/dsh/context-manager-tiered-preflight.mjs
COPY docker/dsh-web-manager.py /opt/dsh/host/web-manager.py
COPY docker/apply-session-deletions.sh /usr/local/bin/apply-dsh-session-deletions
COPY docker/dsh-bind.patch.yml /opt/dsh/dsh-bind.patch.yml
COPY docker/resolve-bind-host.js /usr/local/bin/resolve-dsh-bind-host
# Keep the source module name beside the health probe for Node require().
COPY docker/resolve-bind-host.js /usr/local/bin/resolve-bind-host.js
COPY docker/dsh-healthcheck.js /usr/local/bin/dsh-healthcheck.js
COPY docker/test-dsh-core-routes.js /usr/local/bin/test-dsh-core-routes.js
COPY docker/dsh-plugin-doctor.js /usr/local/bin/dsh-plugin-doctor.js
COPY tests/test-web-browser-e2e.cjs /usr/local/bin/test-dsh-web-browser-e2e.cjs
COPY tests/web-browser-onboarding.cjs /usr/local/bin/web-browser-onboarding.cjs
COPY docker/dsh-web-token.js /usr/local/bin/dsh-web-token.js
COPY docker/prepare-native-web-plugins.js /usr/local/bin/prepare-dsh-native-web-plugins.js
COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN node --check /usr/local/bin/resolve-dsh-bind-host \
 && node --check /usr/local/bin/dsh-healthcheck.js \
 && node --check /usr/local/bin/test-dsh-core-routes.js \
 && node --check /usr/local/bin/dsh-web-token.js \
 && node --check /usr/local/bin/dsh-plugin-doctor.js \
 && node --check /usr/local/bin/test-dsh-web-browser-e2e.cjs \
 && node --check /opt/dsh/plugins/dsh-web-search/index.js \
 && node --check /opt/dsh/plugins/dsh-web-search/client.js \
 && node --check /opt/dsh/plugins/dsh-web-search/embedded.js \
 && node --check /opt/dsh/plugins/dsh-web-search/router.js \
 && node --check /opt/dsh/plugins/dsh-reasoning-editor/index.js \
 && node --check /opt/dsh/plugins/dsh-reasoning-editor/client.js \
 && bash -n /usr/local/bin/dsh-session-manager \
 && node --check /opt/dsh/plugins/dsh-web-search/providers/searxng.js \
 && node --check /opt/dsh/plugins/dsh-web-search/providers/brave.js \
 && bash -n /usr/local/bin/apply-dsh-session-deletions \
 && node --check /opt/dsh/plugins/dsh-session-manager-web/index.js \
 && node --check /opt/dsh/plugins/dsh-session-manager-web/client.js \
 && node --check /opt/dsh/plugins/dsh-instance-manager/index.js \
 && node --check /opt/dsh/plugins/dsh-instance-manager/client.js \
 && node --check /opt/dsh/plugins/dsh-prompt-manager/index.js \
 && node --check /opt/dsh/plugins/dsh-prompt-manager/core.mjs \
 && node --check /opt/dsh/plugins/dsh-prompt-manager/permissions.mjs \
 && node --check /opt/dsh/plugins/dsh-prompt-manager/client.js \
 && node --check /opt/dsh/plugins/dsh-context-manager/index.js \
 && node --check /opt/dsh/plugins/dsh-context-manager/core.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/native-inventory.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/policy.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/storage.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/tiered-core.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/tiered-backend.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/tiered-native.js \
 && node --check /opt/dsh/plugins/dsh-context-manager/history-index.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/ci-replay.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/ownership-audit.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/takeover.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/acp-pending.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/acp-ccr.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/lab-readiness.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/acp-recovery.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/acp-native.js \
 && node --check /opt/dsh/context-manager-tiered-preflight.mjs \
 && node --check /opt/dsh/plugins/dsh-context-manager/client.js \
 && node --check /opt/dsh/plugins/dsh-icon-dock/client.js \
 && node --check /usr/local/bin/prepare-dsh-native-web-plugins.js \
 && chmod 0755 /usr/local/bin/apply-dsh-session-deletions /usr/local/bin/dsh-session-manager /usr/local/bin/dsh-entrypoint /usr/local/bin/patch-dsh-market-container-restart.js

# Verify the real upstream /compact command dispatches to the unique service.
COPY tests/test-context-manager-native-compact.mjs /opt/dsh/test-context-manager-native-compact.mjs
RUN node /opt/dsh/test-context-manager-native-compact.mjs
COPY tests/test-context-manager-native-transaction.mjs /opt/dsh/test-context-manager-native-transaction.mjs
RUN node /opt/dsh/test-context-manager-native-transaction.mjs
COPY tests/test-context-manager-acp-native.mjs /opt/dsh/test-context-manager-acp-native.mjs
RUN node /opt/dsh/test-context-manager-acp-native.mjs
COPY tests/lib/context-manager-legacy-probe.mjs /opt/dsh/test-lib/context-manager-legacy-probe.mjs
COPY tests/fixtures/context-manager/acp-0.0.101-session.json /opt/dsh/test-fixtures/acp-0.0.101-session.json
COPY tests/test-context-manager-m0-native.mjs /opt/dsh/test-context-manager-m0-native.mjs
RUN node /opt/dsh/test-context-manager-m0-native.mjs
COPY tests/test-context-manager-acp-real-region.mjs /opt/dsh/test-context-manager-acp-real-region.mjs
RUN node /opt/dsh/test-context-manager-acp-real-region.mjs
COPY tests/test-context-manager-acp-t3.mjs /opt/dsh/test-context-manager-acp-t3.mjs
RUN node /opt/dsh/test-context-manager-acp-t3.mjs
COPY tests/test-context-manager-acp-tools.mjs /opt/dsh/test-context-manager-acp-tools.mjs
RUN node /opt/dsh/test-context-manager-acp-tools.mjs
COPY tests/test-context-manager-acp-agent-loop.mjs /opt/dsh/test-context-manager-acp-agent-loop.mjs
RUN node /opt/dsh/test-context-manager-acp-agent-loop.mjs
COPY tests/test-context-manager-ccr.mjs /opt/dsh/test-context-manager-ccr.mjs
RUN node /opt/dsh/test-context-manager-ccr.mjs
COPY tests/test-context-manager-acp-fork.mjs /opt/dsh/test-context-manager-acp-fork.mjs
RUN node /opt/dsh/test-context-manager-acp-fork.mjs
COPY tests/test-context-manager-acp-benchmark.mjs /opt/dsh/test-context-manager-acp-benchmark.mjs
RUN node /opt/dsh/test-context-manager-acp-benchmark.mjs
COPY tests/test-context-manager-external-preflight.mjs /opt/dsh/test-context-manager-external-preflight.mjs
RUN node /opt/dsh/test-context-manager-external-preflight.mjs

# Import native summary candidate without mounting another compression owner.
RUN node --input-type=module -e "const m = await import('/opt/dsh/plugins/dsh-context-manager/tiered-native.js'); if (typeof m.default !== 'function') throw Error('tiered backend export missing')"
RUN set -eu; home="$(mktemp -d)"; \
    DSH_HOME="$home" dsh --profile web --patch /opt/dsh/plugins/dsh-context-manager/cordis.patch.yml --dump-config > /tmp/dsh-context-manager-config.yml; \
    grep -q 'id: dsh-docker-context-manager' /tmp/dsh-context-manager-config.yml; \
    rm -rf "$home" /tmp/dsh-context-manager-config.yml

ENV CHROME_BIN=/usr/local/bin/chromium \
    CHROMIUM_PATH=/usr/local/bin/chromium

WORKDIR /workspace
VOLUME ["/root/.dsh"]
EXPOSE 3080

# The entrypoint binds Web to a concrete container IP, not necessarily loopback.
# Reuse the same resolver; the healthcheck is also inherited by Research images.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "/usr/local/bin/dsh-healthcheck.js"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dsh-entrypoint"]
CMD ["web"]
