# DSH Reverse Edition — 独立逆向工程镜像

**这是与 Standard DSH 分开的另一个容器，不是在普通 Agent 内加载全局 dsh-purge。** 镜像包含完整 dsh-purge 插件（提示词管理、主插件、红队演练、逆向 Agent、全部原有工具、Web 工作台）及 REA 6.4.0。Standard 的容器、DSH 安装文件与持久卷均不会被 Reverse 中的全局补丁修改。

## 使用

正式镜像发布后，优先通过统一管理器安装独立实例（不会使用 Standard 的配置与数据）：

~~~bash
bash install.sh reverse
# 如果已经安装了 dshd 管理器，也可以直接：
dshd reverse install
dshd reverse status
dshd reverse logs
dshd reverse update
~~~

逆向版默认容器名 `dsh-reverse`、宿主端口 `3081`、专用配置目录 `/etc/dshd-reverse`（root 模式；非 root 位于用户配置目录下），以及独立的持久化路径。已有 Standard 的 `dshd` 命令仍管理原来的 Standard 实例。管理菜单第 21 项也可调用独立逆向安装。

以下是面向从源码构建的替代方式：


在本仓库根目录运行：

~~~bash
docker compose -f docker-compose.reverse.yml up -d --build
docker compose -f docker-compose.reverse.yml logs -f dsh-reverse
~~~

入口 http://127.0.0.1:3081；原 Standard 仍运行在 3080。两者有不同的 Compose 项目名、容器、DSH_HOME 持久卷及工作区（默认 reverse-workspace，可通过 DSH_REVERSE_WORKSPACE 指定）。不挂载宿主 Docker Socket、不启用 privileged、也不共享 Standard 的私有配置和 API 凭据。

## 隔离边界

| 项目 | Standard | Reverse |
|---|---|---|
| Compose 项目 | 原项目 | dsh-reverse |
| Docker 容器 | dsh | dsh-reverse |
| 端口 | 3080 | 3081 |
| DSH_HOME | 原 dsh-home 卷 | dsh-reverse-home |
| 工作区 | 原 workspace | reverse-workspace |
| 全局 dsh-purge 补丁 | 无 | 完整加载，并支持 Apply |
| REA + 反编译工具 | 不强制 | 镜像预装 |

**非常重要：完整 dsh-purge 具有宿主级系统提示词、权限和沙箱修改。逆向容器里的其他 Agent 也可能受其影响。真正的隔离边界是 Standard 与 Reverse 这两个进程和容器，而不是同一个 Reverse 进程内的两个 Agent。** 容器不隔离 Linux 内核漏洞，不等于可以安全运行不可信可执行文件。

## 预装组件

- dsh-purge：固定源代码提交 28c8eaf5b5de70d53795387d01faae9498a83d63。保留原有 Cordis 配置的全部声明（仅调整包解析路径）。原完整 Web 客户端也打包。
- REA：固定 rea-agents@6.4.0，Agent 内通过本地 stdio 的 rea mcp 调用。
- Ghidra 12.1.4：官方发行包 SHA-256 校验；JDK 21；目录 /opt/ghidra。
- JADX 1.5.3：官方发行包 SHA-256 校验；另含 Ubuntu apktool 与 REA 所需的 jadx-headless-mcp 0.7.1（SHA-256 校验）。
- GDB / gdb-multiarch / binutils / file / patchelf / strace / ltrace。
- Python 虚拟环境：pwntools 4.15.0、frida-tools 14.11.0。

IDA / Hopper 是专有商业工具，不包含、不再分发。Frida 的移动设备服务端也没有安装；Ghidra、JADX 的图形界面需要额外显示环境。REA 工具对外部分析器是否真的兼容，要看实际 MCP 工具输出。

## Reverse Agent 内置 Skills

除了上游已有的 REA 工作流 Skill，Reverse Edition 内置 **9 个**静态定义的分析 Skills：

- `binary-triage`：PE / ELF / 固件文件头、哈希、导入表和结构初检。
- `ghidra-headless`：Ghidra 无界面静态反编译、函数与引用定位。
- `electron-javascript-analysis`：Electron ASAR、Main / Preload / Renderer、IPC 与模块调用链。
- `reverse-evidence-report`：项目证据、阶段检查点、验证与报告。
- `gdb-native-debugging`：GDB 离线 Core Dump、栈帧、寄存器、ABI 与授权隔离调试。
- `frida-runtime-instrumentation`：Frida 授权动态观察设计、有限插桩与实验复现。
- `javascript-deobfuscation`：不执行目标代码的 JavaScript 混淆还原、常量追踪与调用关系。
- `network-protocol-reconstruction`：HAR / 已授权网络记录的 API、WebSocket 与状态机分析。
- `firmware-static-analysis`：固件段结构、体系架构、受限解包与 Ghidra 静态分析。

原 `android-apk-analysis` Skill **已从内置清单和镜像源码删除**。如果此前安装了完全未修改的内置副本，启动器会识别其文件内容并清理；如果是用户自定义修改版则不会删除。**仅删除 Android Skill；REA 所用的 JADX、apktool、JADX Headless MCP 底层工具暂时保留，以免破坏插件兼容性。**

Skills 作为只读说明文件随镜像打包到 `/opt/dsh-reverse/skills/`，启动时只向 `$DSH_HOME/reverse-engineering/skills/` 复制缺失项，不覆盖现有同名用户文件。动态调试、附加进程、外部网络操作均需另外取得授权；未知程序不能仅因在 Docker 内就视为安全。参考了 [Trail of Bits Ghidra Headless](https://github.com/trailofbits/skills-curated/tree/main/plugins/ghidra-headless) 的分析组织方式，以上文件是本项目自行编写的内容，不打包第三方不明执行脚本。

## 版本自动发布

与 Research Edition 一样，Standard 发布成功后将**精确的基础镜像 SHA-256 digest**、DSH 版本、上游 channel 与源码提交传给 `build-reverse.yml`，独立构建和发布 Reverse，不阻塞 Standard 的成功状态。

浮动标签 `:reverse`；版本标签如 `:reverse-0.2.1-alpha.2`；通道标签如 `:reverse-alpha`。Reverse-only 提交仍可独立发布；同一提交若同时改了 Standard，则等待 Standard 发布完后自动触发，避免使用版本不匹配的 `:latest` 基础镜像。完整构建/发布也需要 CI 与必要的镜像权限。

## 完整 dsh-purge 的启动与验收

1. 启动逆向版，进入 DSH Web 后确认 dsh-purge Dock 和「逆向工程」Agent 出现。
2. 完整 dsh-purge 的原始默认 autoApplyOnStart 仍为 false。按照作者工作流进入 Clean → Apply，**只会修改 Reverse 容器内**的 DSH 安装文件。
3. 重启 Reverse 容器并新建会话，确认补丁已应用，红队和逆向工作台可进入。
4. 检查 mcp__rea__ 工具实际发现并对授权的只读样本试运行。
5. 独立进入 Standard DSH，检查正常 Agent 的提示词、工具、原有会话数据都保持不变。

## 发布与限制

- Dockerfile：reverse/Dockerfile；Compose：docker-compose.reverse.yml；CI：.github/workflows/build-reverse.yml。
- BASE_IMAGE 默认使用已发布的 GHCR Standard latest。正式部署建议设置 DSH_REVERSE_BASE_IMAGE 为经验证的 digest。
- 构建时拉取固定 dsh-purge commit，并预装所有软件；启动容器不会再自动 npm/pip 安装。
- PR CI 构建 amd64 审核镜像，验证插件行、工具、Skills 与真实 Web 启动；正式发布支持 amd64 和 arm64，成功后推送 ghcr.io/paimoncai/dsh-docker-install:reverse 及匹配 Standard 版本号的标签。
- 建议不要向公网直接暴露逆向镜像，尤其不要给它挂载 Docker Socket、SSH 私钥或敏感宿主路径。
- 仅分析具有合法授权的目标；动态执行或外网测试前须单独确认。
