#!/usr/bin/env python3
"""Host-side executor for the image-bundled DSH management plugin."""
import argparse
from collections import deque
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import threading
import time
import uuid

NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z")
UPLOAD_FILE = re.compile(r"upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.dshbak\Z")
BACKUP_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.dshbak\Z")
NEW_INSTANCE = re.compile(r"[a-z][a-z0-9-]{0,31}\Z")
MAX_WEB_ARCHIVE = 1024 * 1024 * 1024  # 1 GiB upload cap
JOB = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
ACTIONS = {
    "check": [], "update": ["update"], "restart": ["restart"],
    "recreate": ["recreate"], "rollback": ["rollback"], "cleanup": ["rollback", "clear"],
    "proxy-start": ["proxy", "enable"], "proxy-stop": ["proxy", "disable"],
    "proxy-restart": ["proxy", "reload"], "proxy-test": ["proxy", "test"],
    "proxy-test-all": ["proxy", "test-all"], "proxy-refresh": ["proxy", "refresh"],
    # Edition changes are fixed targets, never arbitrary image URLs.
    "edition-standard": ["web-switch", "standard"],
    "edition-research": ["web-switch", "research"],
    "pack-none": ["web-switch", "research"],
    "pack-economics": ["web-switch", "research-economics"],
    "diagnose-environment": ["env"],
    "diagnose-storage": ["storage", "show"],
    "diagnose-plugins": ["doctor", "plugins", "--json"],
    "dashboard-start": ["dashboard", "start"],
    "dashboard-stop": ["dashboard", "stop"],
    "backup-export": ["backup", "export"],
    "backup-auto-off": ["backup", "auto", "off"],
}

# Phase 1: the host remains the authority. Expose only names that the
# executor actually knows; this is metadata, not an executable command list.
OPERATION_CONTRACT_VERSION = 1
SUPPORTED_OPERATIONS = tuple(sorted((*ACTIONS, "settings", "proxy-use", "proxy-add", "proxy-subscribe",
                                     "backup-verify", "backup-import", "backup-auto-on")))


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def redact(value):
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(value))
    text = re.sub(r"(?i)([?&](?:token|key|api_key)=)[^\s&\"']+", r"\1[hidden]", text)
    text = re.sub(r"(?i)\b(?:https?|socks5?|vless|trojan|hysteria2|ss)://[^\s\"']+",
                  "[address hidden]", text)
    # Explicitly mask JSON-formatted secrets as well as CLI-style key=value.
    text = re.sub(r'(?i)("(?:token|api[_-]?key|access[_-]?token|password|secret|authorization)"\s*:\s*")[^"]*(")',
                  r"\1[hidden]\2", text)
    text = re.sub(r"(?i)(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,\"']+",
                  r"\1[hidden]", text)
    text = re.sub(r"(?i)(\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[\"']?)[^\s,\"'}]+",
                  r"\1[hidden]", text)
    return re.sub(r"\bsk-[A-Za-z0-9_-]{8,}", "[key hidden]", text)


def read_json(path, limit=16384):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise ValueError("invalid task file")
        return json.load(stream)


def write_json(path, value):
    tmp = path.with_name("." + path.name + "-" + uuid.uuid4().hex)
    try:
        with open(tmp, "x", encoding="utf-8") as stream:
            os.chmod(tmp, 0o600)
            json.dump(value, stream, ensure_ascii=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()


def command_for(action, arguments):
    if not isinstance(arguments, dict):
        raise ValueError("invalid arguments")
    if action in ACTIONS and not arguments:
        return list(ACTIONS[action])
    if action == "proxy-use" and set(arguments) == {"name"} and isinstance(arguments["name"], str) and NAME.fullmatch(arguments["name"]):
        return ["proxy", "use", arguments["name"]]
    if action in ("proxy-add", "proxy-subscribe") and set(arguments) == {"name", "url"}:
        name, url = arguments["name"], arguments["url"]
        if not isinstance(name, str) or not NAME.fullmatch(name):
            raise ValueError("invalid node name")
        schemes = r"https?://" if action == "proxy-subscribe" else r"(?:https?|socks5?|vless|trojan|hysteria2|ss)://"
        if not isinstance(url, str) or len(url) > 8192 or re.search(r"[\x00-\x20\x7f]", url) or not re.match(schemes, url):
            raise ValueError("invalid proxy address")
        return ["proxy", "subscribe" if action == "proxy-subscribe" else "add", name, url]
    if action == "backup-verify" and set(arguments) == {"file"} and isinstance(arguments["file"], str) and BACKUP_FILE.fullmatch(arguments["file"]):
        return ["backup", "verify", arguments["file"]]
    if action == "backup-import" and set(arguments) == {"file", "instance"} and isinstance(arguments["file"], str) and BACKUP_FILE.fullmatch(arguments["file"]) and isinstance(arguments["instance"], str) and NEW_INSTANCE.fullmatch(arguments["instance"]) and arguments["instance"] != "default":
        return ["backup", "import", arguments["file"], arguments["instance"]]
    if action == "backup-auto-on" and set(arguments) == {"cadence", "keep"} and arguments["cadence"] in ("daily", "weekly") and type(arguments["keep"]) is int and 1 <= arguments["keep"] <= 90:
        return ["backup", "auto", "on", arguments["cadence"], str(arguments["keep"])]
    raise ValueError("unsupported operation")


def remote_image_id(manifests, os_name, architecture, variant=""):
    """Compare platform image config IDs, not an index digest with a config ID."""
    for item in manifests if isinstance(manifests, list) else [manifests]:
        platform = item.get("Descriptor", {}).get("platform", {})
        if platform.get("os") != os_name or platform.get("architecture") != architecture:
            continue
        if variant and platform.get("variant", "") != variant:
            continue
        manifest = item.get("SchemaV2Manifest") or item.get("OCIManifest") or {}
        digest = manifest.get("config", {}).get("digest")
        if isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            return digest
    raise ValueError("registry did not return this instance's platform manifest")


class Manager:
    def __init__(self, state, dshd, instance=""):
        self.state, self.dshd = Path(state).resolve(), str(Path(dshd).resolve())
        self.bridge = self.state / "web-management"
        self.requests, self.results = self.bridge / "requests", self.bridge / "results"
        self.private = self.state / "web-management-private"
        self.backups = self.state / "backups"
        self.uploads = self.bridge / "uploads"
        for directory in (self.bridge, self.requests, self.results, self.private, self.backups, self.uploads):
            if directory.is_symlink():
                raise ValueError("unsafe management directory")
            directory.mkdir(mode=0o700, exist_ok=True)
            os.chmod(directory, 0o700)
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("DSH", "DEEPSEEK_", "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"))}
        self.env.update(DSHD_STATE_DIR=str(self.state), DSHD_NO_SELF_UPDATE="1",
                        DSHD_WEB_CONFIRMED="1", NO_COLOR="1")
        if instance:
            self.env["DSHD_INSTANCE_ID"] = instance
        self.settings_path = self.private / "settings.json"
        self.settings = {"checkInterval": 21600}
        if self.settings_path.exists():
            self.settings = self.validate_settings(read_json(self.settings_path))
        self.release = None
        self.refresh_pending = False
        self.next_check = 0
        self.next_snapshot = 0
        # A single host-owned Docker follower publishes a bounded redacted
        # window to the existing read-only bridge. The Web host never receives
        # a Docker socket, arbitrary executable, or unredacted pipe.
        self.log_generation = str(uuid.uuid4())
        self.log_seq = 0
        self.log_lines = deque(maxlen=200)
        self.log_stop = threading.Event()
        self.log_thread = None
        self.log_process = None

    @staticmethod
    def validate_settings(data):
        if not isinstance(data, dict) or set(data) != {"checkInterval"}:
            raise ValueError("invalid settings")
        value = data["checkInterval"]
        if type(value) is not int or value not in (0, 3600, 21600, 86400):
            raise ValueError("invalid update interval")
        return {"checkInterval": value}

    def run(self, args, timeout=30, merge=False):
        result = subprocess.run(args, env=self.env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT if merge else subprocess.PIPE,
                                timeout=timeout, check=False)
        if result.returncode:
            raise RuntimeError(redact((result.stderr or result.stdout).decode("utf-8", "replace")[-2000:]) or "command failed")
        return result.stdout.decode("utf-8", "replace")

    def describe(self):
        fields = self.run(["bash", self.dshd, "web", "describe"]).split("\0")
        return dict(zip(fields[::2], fields[1::2]))

    def inspect(self, name):
        return json.loads(self.run(["docker", "inspect", name]))[0]

    def append_log_line(self, line):
        # Limit individual lines *before* they reach the persistent bridge.
        safe = redact(line).replace("\x00", "")[-8192:]
        self.log_seq += 1
        self.log_lines.append({"seq": self.log_seq, "text": safe})
        # Strict UTF-8 byte budget for JSON persisted through a 0600 file.
        # Reserve room for metadata and escaping.
        while self.log_lines and sum(len(json.dumps(item, ensure_ascii=True)) for item in self.log_lines) > 44000:
            self.log_lines.popleft()

    def publish_log_stream(self):
        write_json(self.results / "log-stream.json", {
            "generation": self.log_generation, "seq": self.log_seq,
            "updatedAt": now(), "entries": list(self.log_lines),
        })

    def follow_logs(self):
        """Follow only this DSH container; restart the follower on Docker EOF."""
        while not self.log_stop.is_set():
            process = None
            selector = None
            pending = b""
            dirty = False
            last_publish = 0
            try:
                name = self.describe()["name"]
                if not NAME.fullmatch(name):
                    raise ValueError("invalid DSH container name")
                process = subprocess.Popen(
                    ["docker", "logs", "--follow", "--tail", "200", name],
                    env=self.env, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                self.log_process = process
                selector = selectors.DefaultSelector()
                selector.register(process.stdout, selectors.EVENT_READ)
                while not self.log_stop.is_set():
                    events = selector.select(timeout=0.2)
                    if events:
                        chunk = os.read(process.stdout.fileno(), 8192)
                        if not chunk:
                            break
                        pending += chunk
                        while b"\n" in pending:
                            line, pending = pending.split(b"\n", 1)
                            self.append_log_line(line.decode("utf-8", "replace").rstrip("\r"))
                            dirty = True
                        # Do not let an untrusted line grow without a newline.
                        if len(pending) > 32768:
                            self.append_log_line(pending[-8192:].decode("utf-8", "replace"))
                            pending = b""
                            dirty = True
                    if dirty and time.monotonic() - last_publish >= 0.25:
                        self.publish_log_stream()
                        dirty = False
                        last_publish = time.monotonic()
                    if process.poll() is not None and not events:
                        break
                if pending:
                    self.append_log_line(pending.decode("utf-8", "replace"))
                    dirty = True
            except Exception as error:
                self.append_log_line("[log stream unavailable] " + redact(error))
                dirty = True
            finally:
                if dirty:
                    with contextlib.suppress(Exception):
                        self.publish_log_stream()
                if selector:
                    selector.close()
                if process:
                    if process.poll() is None:
                        process.terminate()
                    with contextlib.suppress(subprocess.TimeoutExpired):
                        process.wait(timeout=2)
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    if process.stdout:
                        process.stdout.close()
                self.log_process = None
            # The container may have been replaced. Reattach by name.
            self.log_stop.wait(1)

    def start_log_stream(self):
        if self.log_thread is not None:
            return
        self.publish_log_stream()
        self.log_thread = threading.Thread(target=self.follow_logs, daemon=True, name="dsh-log-follower")
        self.log_thread.start()

    def stop_log_stream(self):
        self.log_stop.set()
        if self.log_process and self.log_process.poll() is None:
            self.log_process.terminate()
        if self.log_thread:
            self.log_thread.join(timeout=3)

    def list_backups(self):
        entries = []
        for directory, kind in ((self.backups, "saved"), (self.uploads, "uploaded")):
            if directory.is_symlink() or not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not BACKUP_FILE.fullmatch(path.name):
                    continue
                try:
                    info = path.lstat()
                except FileNotFoundError:  # timer pruning an expired snapshot
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                entries.append({"file": path.name, "kind": kind,
                                "size": info.st_size,
                                "createdAt": datetime.datetime.fromtimestamp(info.st_mtime, datetime.timezone.utc).isoformat()})
        return sorted(entries, key=lambda row: row["createdAt"], reverse=True)[:50]

    def backup_schedule(self):
        hash_id = hashlib.sha256(str(self.state).encode()).hexdigest()[:12]
        prefix = "dshd-backup-" + hash_id
        timer = Path("/etc/systemd/system") / (prefix + ".timer")
        service = Path("/etc/systemd/system") / (prefix + ".service")
        result = {"enabled": False, "cadence": "daily", "keep": 7}
        if timer.is_file() and not timer.is_symlink() and service.is_file() and not service.is_symlink():
            try:
                schedule = timer.read_text(encoding="utf-8")[:8192]
                settings = service.read_text(encoding="utf-8")[:8192]
                cadence = re.search(r"(?m)^OnCalendar=(daily|weekly)$", schedule)
                keep = re.search(r"(?m)^Environment=DSHD_AUTO_BACKUP_KEEP=(\d+)$", settings)
                if cadence and keep and 1 <= int(keep.group(1)) <= 90:
                    result.update(enabled=True, cadence=cadence.group(1), keep=int(keep.group(1)))
            except OSError:
                pass
        return result

    def archive_path(self, filename):
        if not isinstance(filename, str) or not BACKUP_FILE.fullmatch(filename):
            raise ValueError("invalid archive filename")
        directory = self.uploads if UPLOAD_FILE.fullmatch(filename) else self.backups
        path = directory / filename
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size == 0:
            raise ValueError("archive missing or unsafe")
        if directory == self.uploads and info.st_size > MAX_WEB_ARCHIVE:
            raise ValueError("uploaded archive exceeds 1 GiB")
        return path

    def snapshot(self):
        description = self.describe()
        snapshot = {"schema": 1, "heartbeat": now(), "instance": description,
                    "management": {"schema": OPERATION_CONTRACT_VERSION,
                                   "operations": list(SUPPORTED_OPERATIONS)},
                    "settings": self.settings, "release": self.release, "container": None,
                    "proxy": {"nodes": [], "running": False}, "logs": "",
                    "backup": {"files": self.list_backups(), "schedule": self.backup_schedule()}}
        try:
            container = self.inspect(description["name"])
            image = json.loads(self.run(["docker", "image", "inspect", container["Image"]]))[0]
            labels = image.get("Config", {}).get("Labels") or {}
            snapshot["container"] = {
                "state": container["State"]["Status"],
                "health": container["State"].get("Health", {}).get("Status", "none"),
                "imageId": container["Image"],
                "version": labels.get("org.opencontainers.image.version", ""),
            }
            if self.release and (
                self.release.get("current") and self.release["current"] != container["Image"]
                or self.release.get("target") and self.release["target"] != description["image"]
            ):
                self.clear_release(recheck=bool(self.settings["checkInterval"]))
                snapshot["release"] = None
            # A bounded, redacted rolling snapshot consumed only by the authenticated
            # Web manager. No Docker socket or arbitrary log command in DSH.
            output = self.run(["docker", "logs", "--tail", "200", description["name"]], merge=True)
            snapshot["logs"] = redact(output)[-48000:]
            snapshot["logsUpdatedAt"] = snapshot["heartbeat"]
        except Exception as error:
            snapshot["containerError"] = redact(error)
        try:
            proxy = self.inspect(description["name"] + "-proxy")
            snapshot["proxy"]["running"] = bool(proxy["State"]["Running"])
        except Exception:
            pass
        # Dashboard is an optional research-only sidecar; never inspect arbitrary
        # names supplied by Web or expose its filesystem paths.
        snapshot["dashboard"] = {"running": False}
        if description.get("edition") == "research":
            try:
                dashboard = self.inspect(description["name"] + "-dashboard")
                snapshot["dashboard"]["running"] = bool(dashboard["State"]["Running"])
            except Exception:
                pass
        nodes = self.state / "proxy" / "nodes"
        if nodes.is_dir():
            snapshot["proxy"]["nodes"] = sorted(p.stem for p in nodes.glob("*.json")
                                                    if NAME.fullmatch(p.stem) and not p.is_symlink())
        write_json(self.results / "status.json", snapshot)
        self.next_snapshot = time.monotonic() + 10

    def clear_release(self, recheck=False):
        self.release = None
        self.refresh_pending = recheck
        write_json(self.private / "release.json", None)

    def check(self):
        self.refresh_pending = False
        self.next_check = time.monotonic() + (self.settings["checkInterval"] or 21600)
        context = {}
        try:
            description = self.describe()
            container = self.inspect(description["name"])
            context = {"current": container["Image"], "target": description["image"]}
            image = json.loads(self.run(["docker", "image", "inspect", container["Image"]]))[0]
            manifests = json.loads(self.run(["docker", "manifest", "inspect", "--verbose",
                                             description["image"]], timeout=120))
            remote = remote_image_id(manifests, image["Os"], image["Architecture"], image.get("Variant", ""))
            if (self.inspect(description["name"])["Image"] != container["Image"]
                    or self.describe()["image"] != description["image"]):
                raise RuntimeError("instance changed during update check; retry")
            self.release = {"checkedAt": now(), "available": remote != container["Image"],
                            **context, "latest": remote}
        except Exception as error:
            self.release = {"checkedAt": now(), "available": None, **context, "error": redact(error)}
        write_json(self.private / "release.json", self.release)
        if self.release.get("error"):
            raise RuntimeError(self.release["error"])

    def execute(self, job, arguments):
        action = job["action"]
        if action == "settings":
            self.settings = self.validate_settings(arguments)
            write_json(self.settings_path, self.settings)
            self.next_check = time.monotonic() + self.settings["checkInterval"]
            return
        command = command_for(action, arguments)
        if action in ("backup-verify", "backup-import"):
            # Browser controls a bounded filename, never absolute host paths.
            command[2] = str(self.archive_path(arguments["file"]))
        if action == "check":
            self.check()
            return
        # No shell interpolation or arbitrary executable supplied by the Web.
        process = subprocess.Popen(["bash", self.dshd, *command], env=self.env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        output = b""
        job["pid"] = process.pid
        self.save_job(job)
        try:
            import selectors
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + 3600
            while True:
                if time.monotonic() > deadline:
                    raise TimeoutError("operation exceeded one hour")
                events = selector.select(timeout=1)
                for key, _ in events:
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        output = (output + chunk)[-32768:]
                        job["log"] = redact(output.decode("utf-8", "replace"))[-16000:]
                        self.save_job(job)
                if process.poll() is not None and not selector.get_map():
                    break
                if time.monotonic() >= self.next_snapshot:
                    self.snapshot()
            if process.returncode:
                raise RuntimeError("operation failed (exit %s); inspect the task log" % process.returncode)
        except BaseException:
            import signal
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
        finally:
            selector.close()
            process.stdout.close()
        if action in ("update", "rollback"):
            # Refresh comparison after replacement; a registry outage is not an upgrade failure.
            self.clear_release(recheck=True)

    def save_job(self, job):
        job["updatedAt"] = now()
        write_json(self.results / (job["id"] + ".json"), job)

    def process(self, path):
        identifier = path.stem
        if not JOB.fullmatch(identifier):
            return
        if (self.results / (identifier + ".json")).exists():
            path.unlink(missing_ok=True)
            return
        job = {"id": identifier, "action": "invalid", "state": "running", "startedAt": now(), "log": ""}
        try:
            request = read_json(path)
            if not isinstance(request, dict) or set(request) != {"id", "action", "arguments", "createdAt"} or request["id"] != identifier:
                raise ValueError("invalid task")
            if not isinstance(request["action"], str):
                raise ValueError("invalid operation")
            created = datetime.datetime.fromisoformat(request["createdAt"].replace("Z", "+00:00"))
            age = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds()
            if age < -60 or age > 600:
                raise ValueError("task expired; inspect the instance and submit again")
            job["action"] = request["action"]
            arguments = request["arguments"]
            if job["action"] == "settings":
                self.validate_settings(arguments)
            else:
                command_for(job["action"], arguments)
            self.save_job(job)
            # Credentials from imports never enter public task history.
            path.unlink()
            self.execute(job, arguments)
            job["state"] = "succeeded"
        except Exception as error:
            job["state"], job["error"] = "failed", redact(error)
        finally:
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
            job["finishedAt"] = now()
            self.save_job(job)
            self.snapshot()

    def recover(self):
        # An interrupted mutation must never be replayed automatically.
        for path in self.results.glob("*.json"):
            if not JOB.fullmatch(path.stem):
                continue
            job = read_json(path, 262144)
            if job.get("state") == "running":
                job.update(state="interrupted", finishedAt=now(),
                           error="Host executor restarted; inspect the instance before retrying.")
                self.save_job(job)
        if (self.private / "release.json").exists():
            self.release = read_json(self.private / "release.json")

    def tick(self):
        self.snapshot()
        pending = sorted(self.requests.glob("*.json"), key=lambda p: p.name)
        for path in pending[:32]:
            self.process(path)
        if self.refresh_pending or self.settings["checkInterval"] and time.monotonic() >= self.next_check:
            with contextlib.suppress(Exception):
                self.check()
            self.snapshot()
        # Keep bounded public history. Only the host can modify results.
        history = sorted((p for p in self.results.glob("*.json") if JOB.fullmatch(p.stem)),
                         key=lambda p: p.stat().st_mtime, reverse=True)
        for path in history[50:]:
            path.unlink()


def main():
    import fcntl
    import signal
    def terminate(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--dshd", required=True)
    parser.add_argument("--instance", default="")
    args = parser.parse_args()
    manager = Manager(args.state_dir, args.dshd, args.instance)
    with open(manager.private / "executor.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manager.recover()
        manager.start_log_stream()
        try:
            while True:
                try:
                    manager.tick()
                except Exception as error:
                    print(redact(error), flush=True)
                time.sleep(3)
        finally:
            manager.stop_log_stream()


if __name__ == "__main__":
    main()
