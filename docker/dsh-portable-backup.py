#!/usr/bin/env python3
"""DSH portable instance backup (v1). Host-side, stdlib only.

The archive holds DSH_HOME, workspace, host manager configuration and every
configured custom bind mount. Import is new-instance-only and does not touch an
existing container, state directory or Docker volume.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import posixpath
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile

FORMAT = "dsh-full-instance-v1"
CONFIG_KEYS = (
    "DSH_EDITION", "DSH_RESEARCH_PACK", "DSH_IMAGE", "DSH_NAME", "DSH_PORT",
    "DSH_BIND_ADDR", "DSH_RESEARCH_DASHBOARD_PORT", "DSH_WORKSPACE",
    "DSH_STORAGE_MODE", "DSH_DATA_DIR", "DSH_VOLUME", "DSH_SHM_SIZE",
    "DSH_TIMEZONE", "DSH_NPM_CACHE", "DSH_MEMORY_LIMIT", "DSH_MEMORY_SWAP",
    "DSH_TRUSTED_HOSTS", "DSHW_ADMIN_HOSTS", "DEEPSEEK_BASE_URL",
    "DEEPSEEK_API_KEY", "DSH_DOCKER_ACCESS", "DSH_DOCKER_SOCKET",
    "DSH_PROXY_ENABLED", "DSH_SEARCH_ENABLED", "DSH_SEARCH_BRAVE_ENABLED",
    "DSH_SEARCH_CACHE_ENABLED", "DSH_SEARCH_IMAGE", "DSH_SEARCH_BRAVE_DAILY_LIMIT",
    "DSH_PROXY_NODE", "DSH_PROXY_IMAGE", "DSH_PROXY_PORT", "DSH_PROXY_NO_PROXY",
    "DSH_PROXY_FAILOVER_ENABLED", "DSH_PROXY_FAILOVER_URL",
    "DSH_PROXY_FAILOVER_INTERVAL", "DSH_PROXY_FAILOVER_TOLERANCE",
    "DSH_PROXY_FAILOVER_IDLE_TIMEOUT", "DSH_PROXY_FAILOVER_INTERRUPT",
)
EXCLUDE_STATE = {
    "backups", "web-management", "web-management-private", "web-manager.py",
    "operation.lock", ".self-update-failed",
}
MAX_ENTRIES = 200000


def fail(message):
    raise ValueError(message)


def digest(path):
    sha = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def docker(*args, stdout=None, check=True):
    return subprocess.run(("docker", *args), stdout=stdout or subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check)


def file_tar(source, destination, excludes=()):
    source = pathlib.Path(source)
    with tarfile.open(destination, "w") as tar:
        if source.is_dir():
            def selected(member):
                relative = pathlib.PurePosixPath(member.name)
                if any(part in excludes for part in relative.parts):
                    return None
                if member.isdev() or member.isfifo():
                    return None
                return member
            tar.add(source, arcname=".", recursive=True, filter=selected)


def mount_sources(config_file):
    entries = []
    if not os.path.isfile(config_file):
        return entries
    with open(config_file, encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            fields = line.split("|")
            if len(fields) != 3:
                fail("无效的 mounts.conf 记录，拒绝生成不完整备份")
            source, target, mode = fields
            if not source.startswith("/") or ":" in source or not os.path.isdir(source):
                fail("自定义挂载源不存在或不能安全打包: " + source)
            if not target.startswith("/") or ".." in pathlib.PurePosixPath(target).parts:
                fail("自定义挂载目标无效")
            if mode not in ("ro", "rw"):
                fail("自定义挂载模式无效")
            entries.append((source, target, mode))
    if len(entries) > 64:
        fail("最多允许打包 64 个自定义挂载")
    return entries


def export_bundle(args):
    output = pathlib.Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        fail("备份文件已存在，拒绝覆盖: " + str(output))
    os.chmod(output.parent, os.stat(output.parent).st_mode & 0o777)
    state = pathlib.Path(args.state)
    if not (state / "config.env").is_file():
        fail("未找到有效的实例配置文件: " + str(state / "config.env"))
    if ":" in args.source:
        fail("存储源含有冒号，无法安全挂载到只读临时容器")
    mounts = mount_sources(str(state / "mounts.conf"))
    paused = False
    try:
        # Pausing the managed container prevents concurrent writes from DSH.
        # Other host processes writing to mounts still require operator quiescence.
        status = docker("inspect", "-f", "{{.State.Status}}", args.name, check=False)
        if status.returncode == 0 and status.stdout.decode().strip() == "running":
            docker("pause", args.name)
            paused = True
        with tempfile.TemporaryDirectory(prefix=".dsh-export-", dir=output.parent) as staging:
            folder = pathlib.Path(staging)
            file_tar(state, folder / "state.tar", EXCLUDE_STATE)
            file_tar(args.workspace, folder / "workspace.tar")
            with open(folder / "data.tar", "wb") as target:
                docker("run", "--rm", "--entrypoint", "tar",
                       "-v", args.source + ":/data:ro", args.image,
                       "-cf", "-", "-C", "/data", ".", stdout=target)
            inventory = []
            payloads = ["state.tar", "workspace.tar", "data.tar"]
            for i, (source, target, mode) in enumerate(mounts):
                filename = "mount-%03d.tar" % i
                file_tar(source, folder / filename)
                payloads.append(filename)
                inventory.append({"file": filename, "target": target, "mode": mode})
            probe = docker("image", "inspect", args.image, "--format",
                           "{{index .RepoDigests 0}}", check=False)
            pinned = probe.stdout.decode().strip() if probe.returncode == 0 else ""
            if not re.search(r"@sha256:[a-f0-9]{64}$", pinned):
                pinned = ""
            config = {k: os.environ[k] for k in CONFIG_KEYS if k in os.environ}
            manifest = {
                "format": FORMAT,
                "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "source_instance": args.name,
                "source_image": args.image,
                "image_digest": pinned,
                "config": config,
                "mounts": inventory,
                "payloads": {p: {"sha256": digest(folder / p),
                                 "size": (folder / p).stat().st_size} for p in payloads},
                "web_management_enabled": (state / "web-management.enabled").exists(),
                "consistent_container_pause": paused,
            }
            (folder / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            tmp = folder / "bundle.tmp"
            with tarfile.open(tmp, "w:gz") as package:
                for name in ("manifest.json", *payloads):
                    package.add(folder / name, arcname=name, recursive=False)
            os.chmod(tmp, 0o600)
            # Never clobber a previous backup, even on same-second collisions.
            if output.exists():
                fail("备份目标已由另一个进程创建，拒绝覆盖")
            os.rename(tmp, output)
            print("完整备份导出成功:", output)
            print("归档 SHA256:", digest(output))
            print("包含: DSH 数据、工作区、宿主机设置、自定义挂载 (%d)" % len(mounts))
            if not pinned:
                print("警告: 该镜像没有可用 digest，导入只能使用原镜像引用", file=sys.stderr)
    finally:
        if paused:
            docker("unpause", args.name)


def read_manifest(package):
    members = package.getmembers()
    if len(members) > 70:
        fail("归档中包含过多顶层项目")
    names = set()
    for item in members:
        if "/" in item.name or not item.isfile() or item.name in names:
            fail("完整备份的外层归档结构不合法")
        names.add(item.name)
    if "manifest.json" not in names or package.getmember("manifest.json").size > 1024 * 1024:
        fail("归档缺少有效清单")
    manifest = json.load(package.extractfile("manifest.json"))
    if manifest.get("format") != FORMAT:
        fail("不是受支持的 DSH 完整实例备份")
    payloads = manifest.get("payloads")
    if not isinstance(payloads, dict) or not {"state.tar", "workspace.tar", "data.tar"} <= payloads.keys():
        fail("归档缺少必要的数据分区")
    if names != {"manifest.json", *payloads}:
        fail("归档清单和实际数据分区不一致")
    mounts = manifest.get("mounts")
    if not isinstance(mounts, list) or len(mounts) > 64:
        fail("挂载清单无效")
    if not isinstance(manifest.get("config"), dict):
        fail("实例配置清单无效")
    for key, value in manifest["config"].items():
        if key not in CONFIG_KEYS or not isinstance(value, str) or "\x00" in value or "\r" in value or "\n" in value:
            fail("归档中包含不安全的配置项: " + str(key))
    for index, mount in enumerate(mounts):
        if not isinstance(mount, dict) or mount.get("file") != "mount-%03d.tar" % index:
            fail("挂载清单顺序或文件名无效")
        if mount.get("mode") not in ("ro", "rw"):
            fail("挂载模式无效")
        target = mount.get("target", "")
        if not isinstance(target, str) or not target.startswith("/") or ".." in pathlib.PurePosixPath(target).parts:
            fail("挂载目标无效")
    for name, desc in payloads.items():
        if not re.fullmatch(r"(state|workspace|data|mount-\d{3})\.tar", name):
            fail("归档分区名称不合法")
        if not isinstance(desc, dict) or not re.fullmatch("[a-f0-9]{64}", str(desc.get("sha256", ""))):
            fail("归档分区校验值无效")
        if not isinstance(desc.get("size"), int) or desc["size"] < 0:
            fail("归档分区长度无效")
    return manifest


def stage_payloads(archive, stage):
    with tarfile.open(archive, "r:gz") as package:
        manifest = read_manifest(package)
        for name, entry in manifest["payloads"].items():
            member = package.getmember(name)
            if member.size != entry["size"]:
                fail("备份数据长度不匹配: " + name)
            path = stage / name
            with package.extractfile(member) as source, open(path, "xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            if digest(path) != entry["sha256"]:
                fail("备份数据 SHA256 校验失败: " + name)
        return manifest


def safe_tar_members(path):
    with tarfile.open(path, "r") as package:
        members = package.getmembers()
        if len(members) > MAX_ENTRIES:
            fail("备份文件条目过多")
        seen = set()
        symlinks = set()
        cleaned = []
        for member in members:
            raw = member.name
            if raw.startswith("/") or "\\" in raw or "\x00" in raw:
                fail("归档条目使用绝对路径或非法字符")
            parts = [p for p in raw.split("/") if p not in ("", ".")]
            if any(part == ".." for part in parts):
                fail("归档存在路径穿越: " + raw)
            name = "/".join(parts)
            if not name:
                continue
            if name in seen:
                fail("归档存在重复路径: " + name)
            seen.add(name)
            if not (member.isdir() or member.isfile() or member.issym()):
                fail("归档含不支持的硬链接、设备或特殊文件")
            if member.issym():
                link = member.linkname
                dest = posixpath.normpath(posixpath.join(posixpath.dirname(name), link))
                if link.startswith("/") or dest == ".." or dest.startswith("../"):
                    fail("归档包含跨出数据目录的软链接: " + name)
                symlinks.add(name)
            cleaned.append((member, name))
        for member, name in cleaned:
            parent = posixpath.dirname(name)
            while parent:
                if parent in symlinks:
                    fail("归档尝试写入软链接下的子路径: " + name)
                parent = posixpath.dirname(parent)
        return cleaned


def extract_verified(path, destination):
    destination.mkdir(parents=True, exist_ok=False)
    members = safe_tar_members(path)  # preflight before creating any inner files
    with tarfile.open(path, "r") as package:
        for member, name in members:
            target = destination.joinpath(*name.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            elif member.issym():
                target.symlink_to(member.linkname)
            else:
                with package.extractfile(member) as source, target.open("xb") as sink:
                    shutil.copyfileobj(source, sink, length=1024 * 1024)
            if not member.issym():
                target.chmod(member.mode & 0o777 & ~0o6000)


def validate_backup(args):
    with tempfile.TemporaryDirectory(prefix="dsh-verify-") as directory:
        stage = pathlib.Path(directory)
        manifest = stage_payloads(args.archive, stage)
        for name in manifest["payloads"]:
            safe_tar_members(stage / name)
        print("完整备份校验通过:", args.archive)
        print("来源镜像:", manifest["image_digest"] or manifest["source_image"])
        print("自定义挂载:", len(manifest["mounts"]))


def restore_bundle(args):
    if not re.fullmatch("[a-z][a-z0-9-]{0,31}", args.instance) or args.instance == "default":
        fail("仅支持导入到合法的新实例 ID")
    state = pathlib.Path(args.state).resolve()
    data = pathlib.Path(args.data).resolve()
    workspace = pathlib.Path(args.workspace).resolve()
    root = pathlib.Path(args.instance_root).resolve()
    if any(p.exists() or p.is_symlink() for p in (state, data, workspace, root)):
        fail("目标状态、数据或工作区已存在；拒绝覆盖任何现有实例")
    if not (1 <= args.port <= 65535 and 1 <= args.dashboard_port <= 65535):
        fail("目标端口无效")
    with tempfile.TemporaryDirectory(prefix="dsh-import-") as directory:
        stage = pathlib.Path(directory)
        manifest = stage_payloads(args.archive, stage)
        for name in manifest["payloads"]:
            safe_tar_members(stage / name)
        # Stage entire restore before exposing the new instance to dshd.
        created = []
        prepared = {}
        try:
            for name, final in (("state.tar", state), ("data.tar", data),
                                ("workspace.tar", workspace)):
                final.parent.mkdir(parents=True, exist_ok=True)
                temp = pathlib.Path(tempfile.mkdtemp(prefix=".dsh-import-", dir=final.parent))
                created.append(temp)
                temp.rmdir()
                extract_verified(stage / name, temp)
                prepared[name] = (temp, final)
            root.mkdir(parents=True, exist_ok=False)
            created.append(root)
            lines = []
            for index, mount in enumerate(manifest["mounts"]):
                mountdir = root / "mounts" / ("%03d" % index)
                extract_verified(stage / mount["file"], mountdir)
                lines.append(str(mountdir) + "|" + mount["target"] + "|" + mount["mode"])
            cfg = manifest["config"].copy()
            cfg.update({
                "DSH_NAME": "dsh-" + args.instance,
                "DSH_PORT": str(args.port),
                "DSH_RESEARCH_DASHBOARD_PORT": str(args.dashboard_port),
                "DSH_BIND_ADDR": "127.0.0.1",
                "DSH_WORKSPACE": str(workspace),
                "DSH_STORAGE_MODE": "bind",
                "DSH_DATA_DIR": str(data),
                # Do not implicitly hand a migrated instance host-root Docker access.
                "DSH_DOCKER_ACCESS": "false",
                "DSH_DOCKER_SOCKET": "",
            })
            image = manifest.get("image_digest") or manifest.get("source_image", "")
            if not isinstance(image, str) or not image or "\n" in image:
                fail("原始镜像引用无效")
            cfg["DSH_IMAGE"] = image
            cfg["DSHD_INSTANCE_ID"] = args.instance
            state_temp = prepared["state.tar"][0]
            (state_temp / "config.env").write_text(
                "".join(key + "=" + shlex.quote(value) + "\n" for key, value in sorted(cfg.items())),
                encoding="utf-8")
            (state_temp / "config.env").chmod(0o600)
            (state_temp / "mounts.conf").write_text(
                "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            (state_temp / "mounts.conf").chmod(0o600)
            # Remove a stale executor state: it must be explicitly re-enabled
            # under a newly generated systemd unit for this new instance.
            for marker in ("web-management.enabled", "web-management.disabled"):
                (state_temp / marker).unlink(missing_ok=True)
            # Commit the shared data/workspace first and state LAST. If the
            # state directory does not exist, dshd cannot adopt a partial clone.
            for name in ("data.tar", "workspace.tar", "state.tar"):
                temp, final = prepared[name]
                if final.exists():
                    fail("导入期间目标出现冲突，拒绝覆盖: " + str(final))
                os.rename(temp, final)
                created.append(final)
            print("完整实例已导入:", args.instance)
            print("原镜像:", image)
            print("新端口:", args.port)
            print("可执行: dshd -i " + args.instance + " recreate")
            if manifest.get("web_management_enabled"):
                print("原 Web 执行器已记录；重新启用: dshd -i " + args.instance + " web enable")
        except Exception:
            for path in reversed(created):
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                elif path.exists() or path.is_symlink():
                    path.unlink()
            raise


def prune(args):
    folder = pathlib.Path(args.directory)
    keep = args.keep
    if keep < 1 or keep > 90:
        fail("自动备份保留数量必须在 1 到 90 之间")
    if not folder.is_dir():
        return
    prefix = re.escape(args.name) + r"-auto-\d{8}-\d{6}\.dshbak"
    files = sorted((f for f in folder.iterdir() if f.is_file() and
                    not f.is_symlink() and re.fullmatch(prefix, f.name)),
                   key=lambda p: p.name, reverse=True)
    for archive in files[keep:]:
        archive.unlink()
    print("自动备份保留:", min(len(files), keep), "份")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    export = sub.add_parser("export")
    for flag in ("output", "state", "workspace", "source", "image", "name"):
        export.add_argument("--" + flag, required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("archive")
    restore = sub.add_parser("import")
    restore.add_argument("archive")
    for flag in ("instance", "state", "data", "workspace", "instance-root"):
        restore.add_argument("--" + flag, required=True)
    restore.add_argument("--port", type=int, required=True)
    restore.add_argument("--dashboard-port", type=int, required=True)
    cleanup = sub.add_parser("prune")
    cleanup.add_argument("--directory", required=True)
    cleanup.add_argument("--name", required=True)
    cleanup.add_argument("--keep", type=int, required=True)
    args = parser.parse_args()
    try:
        {"export": export_bundle, "verify": validate_backup,
         "import": restore_bundle, "prune": prune}[args.action](args)
    except (ValueError, OSError, tarfile.TarError, subprocess.CalledProcessError) as exc:
        print("DSH 完整备份错误:", exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
