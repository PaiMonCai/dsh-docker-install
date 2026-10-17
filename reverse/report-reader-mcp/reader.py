"""Bounded local report readers. No source URI is followed or source file changed."""
from collections import Counter
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import zipfile

MAX_INPUT = 8 * 1024 * 1024
MAX_TEXT = 256 * 1024
MAX_RESULTS = 20000
DOCUMENT_TYPES = {".pdf", ".docx", ".xlsx", ".pptx"}

# The build-time ARM64 smoke runs under QEMU on an amd64 runner.
# CPU accounting charges emulator work, not just guest parsing. Scale limits
# only for synthetic build fixtures; production keeps the original 30s/35s.
def conversion_limits():
    if os.environ.get("DSH_REPORT_READER_CI_EMULATED") == "1":
        return 150, 180
    return 30, 35


def local_bytes(root, value):
    if not value or "://" in value or value.lower().startswith(("data:", "file:")):
        raise ValueError("supply a local workspace path, not a URI")
    root = Path(root).resolve(strict=True)
    supplied = Path(value)
    path = supplied if supplied.is_absolute() else root / supplied
    if ".." in path.parts:
        raise ValueError("parent traversal is not allowed")
    # Reject link components before resolving; the root itself is administrator-owned.
    for part in [path, *path.parents]:
        if part == root:
            break
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("linked input paths are not allowed")
    path = path.resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError("input must be inside the workspace")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_INPUT:
            raise ValueError("input must be a nonempty regular file of at most 8 MiB")
        data = source.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError("input exceeds 8 MiB")
    return path, data, {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "hash_scope": "input report/document bytes, not the analyzed sample",
    }


def text(value, cap=512):
    return value[:cap] if isinstance(value, str) else ""


def objects(value, label):
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("invalid SARIF " + label)
    return value


def rule_for(run, result):
    ref = result.get("rule") or {}
    if not isinstance(ref, dict):
        raise ValueError("invalid SARIF rule reference")
    tool = run.get("tool", {})
    component = tool.get("driver", {})
    component_ref = ref.get("toolComponent", {})
    if component_ref:
        if not isinstance(component_ref, dict):
            raise ValueError("invalid SARIF tool component reference")
        extensions = objects(tool.get("extensions", []), "extensions")
        index = component_ref.get("index")
        if index is not None:
            if type(index) is not int or not 0 <= index < len(extensions):
                raise ValueError("invalid SARIF tool component index")
            component = extensions[index]
        else:
            component = next((c for c in [component, *extensions]
                              if (component_ref.get("name") and c.get("name") == component_ref["name"])
                              or (component_ref.get("guid") and c.get("guid") == component_ref["guid"])), None)
            if component is None:
                raise ValueError("unresolved SARIF tool component")
    rules = objects(component.get("rules", []), "rules")
    index = ref.get("index", result.get("ruleIndex"))
    rule_id = ref.get("id", result.get("ruleId"))
    if index is not None and (type(index) is not int or not 0 <= index < len(rules)):
        raise ValueError("invalid SARIF rule index")
    if isinstance(index, int) and not isinstance(index, bool) and 0 <= index < len(rules):
        rule = rules[index]
        if rule_id and rule.get("id") != rule_id:
            raise ValueError("SARIF rule id/index disagree")
        return rule, component
    return next((r for r in rules if r.get("id") == rule_id), {}), component


def read_sarif(root, path, offset=0, limit=20, level="all"):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 25:
        raise ValueError("offset must be nonnegative; limit must be 1..25")
    if level not in {"all", "error", "warning", "note", "none"}:
        raise ValueError("invalid severity filter")
    _, data, source = local_bytes(root, path)
    log = json.loads(data)
    if not isinstance(log, dict) or log.get("version") != "2.1.0":
        raise ValueError("expected a SARIF 2.1.0 log")
    runs = objects(log.get("runs"), "runs")
    if len(runs) > 100:
        raise ValueError("too many SARIF runs")
    counts, matching, total, seen, duplicates, rows = Counter(), 0, 0, set(), 0, []
    severity_complete = True
    for ri, run in enumerate(runs):
        tool_container = run.get("tool")
        if not isinstance(tool_container, dict) or not isinstance(tool_container.get("driver"), dict):
            raise ValueError("SARIF run must identify its tool driver")
        tool = tool_container["driver"]
        if not isinstance(tool.get("name"), str) or not tool["name"]:
            raise ValueError("SARIF tool driver needs a name")
        if any(inv.get("ruleConfigurationOverrides") for inv in objects(run.get("invocations", []), "invocations")):
            severity_complete = False
        results = objects(run.get("results", []), "results")
        total += len(results)
        if total > MAX_RESULTS:
            raise ValueError("SARIF exceeds 20000 results")
        for ji, result in enumerate(results):
            rule, component = rule_for(run, result)
            kind = result.get("kind", "fail")
            if kind not in {"fail", "pass", "notApplicable", "review", "open", "informational"}:
                raise ValueError("invalid SARIF result kind")
            if kind != "fail" and result.get("level", "none") != "none":
                raise ValueError("SARIF non-fail result cannot have a severity")
            effective = ("none" if kind != "fail" else
                         result.get("level", rule.get("defaultConfiguration", {}).get("level", "warning")))
            if effective not in {"error", "warning", "note", "none"}:
                raise ValueError("invalid SARIF result level")
            if kind == "fail" and effective == "none":
                raise ValueError("SARIF failing result cannot have level none")
            message_record = result.get("message")
            if not isinstance(message_record, dict) or not any(isinstance(message_record.get(k), str)
                                                              for k in ("text", "markdown", "id")):
                raise ValueError("SARIF result needs a message")
            message = message_record.get("text", message_record.get("markdown", ""))
            counts[effective] += 1
            if level != "all" and effective != level:
                continue
            locations = []
            for location in objects(result.get("locations", []), "locations")[:3]:
                physical = location.get("physicalLocation", {})
                artifact = physical.get("artifactLocation", {})
                if "uri" not in artifact and type(artifact.get("index")) is int:
                    artifacts = objects(run.get("artifacts", []), "artifacts")
                    ix = artifact["index"]
                    if 0 <= ix < len(artifacts):
                        artifact = artifacts[ix].get("location", {})
                region = physical.get("region", {})
                locations.append({
                    "uri": text(artifact.get("uri")),
                    "uri_base_id": text(artifact.get("uriBaseId")),
                    "region": {k: region[k] for k in ("startLine", "startColumn", "endLine", "endColumn")
                               if type(region.get(k)) is int},
                })
            fingerprints = result.get("fingerprints") or result.get("partialFingerprints") or {}
            # Exact keys are review hints within this log; never merge results across tools/versions.
            key = json.dumps([tool.get("name"), tool.get("version"), component.get("name"),
                              component.get("version"), result.get("ruleId", rule.get("id")), kind, effective,
                              fingerprints or [result.get("locations", []), message]],
                             sort_keys=True, ensure_ascii=True)
            duplicate = key in seen
            duplicates += int(duplicate)
            seen.add(key)
            if offset <= matching < offset + limit:
                rows.append({
                    "locator": f"runs[{ri}].results[{ji}]",
                    "tool": text(tool.get("name"), 120), "tool_version": text(tool.get("version"), 80),
                    "rule_component": text(component.get("name"), 120),
                    "rule_id": text(result.get("ruleId", rule.get("id")), 160),
                    "level": effective, "kind": text(kind, 32), "message": text(message),
                    "message_truncated": isinstance(message, str) and len(message) > 512,
                    "message_id": text(message_record.get("id"), 160),
                    "locations": locations, "locations_truncated": len(result.get("locations", [])) > 3,
                    "baseline_state": text(result.get("baselineState"), 32),
                    "suppression_statuses": [text(s.get("status"), 32)
                                             for s in objects(result.get("suppressions", []), "suppressions")[:5]],
                    "duplicate_hint": duplicate,
                })
            matching += 1
    next_offset = offset + len(rows) if offset + len(rows) < matching else None
    return {
        "source": source, "total_results": total, "counts_by_level": dict(counts),
        "severity_complete": severity_complete,
        "matching_results": matching, "duplicate_hints": duplicates,
        "results": rows, "next_offset": next_offset,
        "limitations": [
            "Scanner findings are claims, not independently verified vulnerabilities.",
            "No referenced source URI was fetched; locations are producer-supplied.",
            "Duplicates are hints; rows, suppressions and baseline states are retained.",
            "Severity uses result level, rule default, then warning; non-fail kinds use none.",
            "Invocation configuration overrides and message-string lookup are not interpreted.",
            "If severity_complete is false, severity totals and filtering are provisional, not a clean-scan gate.",
        ],
    }


def check_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(e.file_size for e in entries) > 32 * 1024 * 1024:
            raise ValueError("Office archive expansion exceeds the conversion budget")
        if any(e.flag_bits & 1 for e in entries):
            raise ValueError("encrypted Office documents are not supported")


def read_document(root, path, start=0, max_chars=12000):
    if type(start) is not int or start < 0 or type(max_chars) is not int or not 1 <= max_chars <= 12000:
        raise ValueError("start must be nonnegative; max_chars must be 1..12000")
    target, data, source = local_bytes(root, path)
    suffix = target.suffix.lower()
    if suffix not in DOCUMENT_TYPES:
        raise ValueError("supported document types: PDF, DOCX, XLSX, PPTX")
    if suffix != ".pdf":
        check_archive(data)
    elif not data.startswith(b"%PDF-"):
        raise ValueError("invalid PDF header")
    # Conversion gets bytes rather than a path. It cannot select another file or URL.
    _, wall_limit = conversion_limits()
    try:
        completed = subprocess.run([sys.executable, "-I", str(Path(__file__).resolve()), "--convert", suffix],
                                   input=data, capture_output=True, timeout=wall_limit, check=False)
    except subprocess.TimeoutExpired as error:
        if os.environ.get("DSH_REPORT_READER_CI_DIAGNOSTICS") == "1":
            print(f"[report-reader-ci] format={suffix} timeout={wall_limit}s",
                  file=sys.stderr, flush=True)
        raise ValueError("document conversion timed out") from error
    if completed.returncode:
        # Only emit converter stderr for synthetic CI fixtures, never user documents.
        if os.environ.get("DSH_REPORT_READER_CI_DIAGNOSTICS") == "1":
            details = completed.stderr.decode("utf-8", errors="replace")[-3000:]
            print(f"[report-reader-ci] format={suffix} exit={completed.returncode} stderr={details!r}",
                  file=sys.stderr, flush=True)
        raise ValueError("document conversion failed; encrypted, malformed or unsupported document")
    converted = json.loads(completed.stdout)
    content = converted["text"]
    chunk = content[start:start + max_chars]
    return {
        "source": source, "format": suffix[1:], "text": chunk,
        "start": start, "next_start": start + len(chunk) if start + len(chunk) < len(content) else None,
        "converted_chars": len(content), "conversion_truncated": converted["truncated"],
        "locator_scope": "character offsets in converted Markdown, not original document pages/lines",
        "limitations": [
            "Text conversion does not verify the report's claims.",
            "Images, scanned pages, layout and formulas may be missing; OCR is not enabled.",
            "Conversion is capped at 262144 characters; no output file is written.",
        ],
    }


def conversion_worker(suffix):
    # Bound parser CPU/address space on Linux. This is not an OS security sandbox.
    for name in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[name] = "1"
    if sys.platform == "linux":
        import resource
        cpu_limit, _ = conversion_limits()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
        resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    import socket
    def denied(*_args, **_kwargs):
        raise ValueError("network access is disabled during document conversion")
    socket.socket.connect = denied
    socket.socket.connect_ex = denied
    socket.create_connection = denied
    socket.getaddrinfo = denied
    from markitdown import StreamInfo
    from markitdown.converters import PdfConverter, DocxConverter, XlsxConverter, PptxConverter
    converters = {".pdf": PdfConverter, ".docx": DocxConverter, ".xlsx": XlsxConverter, ".pptx": PptxConverter}
    data = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(data) > MAX_INPUT:
        raise ValueError("conversion input too large")
    result = converters[suffix]().convert(io.BytesIO(data), StreamInfo(extension=suffix))
    content = result.markdown
    print(json.dumps({"text": content[:MAX_TEXT], "truncated": len(content) > MAX_TEXT}, ensure_ascii=True))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--convert" or sys.argv[2] not in DOCUMENT_TYPES:
        raise SystemExit("internal conversion worker")
    conversion_worker(sys.argv[2])
