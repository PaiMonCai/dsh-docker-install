# syntax=docker/dockerfile:1
#
# DeepSeek Harness (dsh) 通用开发镜像：
# Node.js / Python / Go / Docker CLI / Playwright Chromium / 常用构建工具。
#
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE}

ARG DSH_VERSION=0.1.5-rc.2
ARG PNPM_VERSION=10
ARG GO_VERSION=1.27.1
ARG TARGETARCH
ARG IN_CHINA=auto
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG DOCKER_APT_BASE=https://download.docker.com/linux/debian

ENV IN_CHINA=${IN_CHINA}

LABEL org.opencontainers.image.title="DeepSeek Harness (dsh)" \
      org.opencontainers.image.description="DeepSeek Harness development container with Node.js, Python, Go, Docker CLI and Chromium" \
      org.opencontainers.image.source="https://github.com/PaiMonCai/dsh-docker-install" \
      org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive \
    DSH_HOME=/root/.dsh \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/go/bin:${PATH}

COPY docker/cn-mirror.sh /usr/local/bin/cn-mirror

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
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      less \
      openssh-client \
      procps \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      tini \
      unzip \
      wget \
      zip \
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
 && node --version \
 && pnpm --version \
 && chromium --version

COPY docker/dsh-bind.patch.yml /opt/dsh/dsh-bind.patch.yml
COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint

ENV CHROME_BIN=/usr/local/bin/chromium \
    CHROMIUM_PATH=/usr/local/bin/chromium

WORKDIR /workspace
VOLUME ["/root/.dsh"]
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DSH_PORT:-3080}/" | grep -qE '^(200|302|401)$'

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dsh-entrypoint"]
CMD ["web"]
