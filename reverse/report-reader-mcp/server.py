"""Private stdio MCP for reading existing local reports, scoped to one workspace."""
import json
import os
from pathlib import Path
from threading import BoundedSemaphore
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from reader import read_document as document, read_sarif as sarif

ROOT = Path(os.environ.get("DSH_REVERSE_WORKSPACE_ROOT", "/workspace")).resolve()
server = FastMCP("reverse-report-reader")
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True)
CONVERSION_SLOT = BoundedSemaphore(1)


@server.tool(annotations=READ_ONLY)
def read_sarif(path: str, offset: int = 0, limit: int = 20, level: str = "all") -> str:
    """Read a workspace SARIF 2.1.0 report with source locators and paginated findings.

    level: all/error/warning/note/none. limit: 1..25. Never fetches artifact URIs.
    Findings remain scanner assertions; this does not run a scan or verify a vulnerability.
    """
    return json.dumps(sarif(ROOT, path, offset, limit, level), ensure_ascii=True)


@server.tool(annotations=READ_ONLY)
def read_document(path: str, start: int = 0, max_chars: int = 12000) -> str:
    """Read a local PDF/DOCX/XLSX/PPTX as bounded Markdown using MarkItDown.

    Only workspace file paths; no URLs or file URIs. start is a converted-text character
    offset; max_chars: 1..12000. Does not write output files or enable OCR/cloud APIs.
    """
    if not CONVERSION_SLOT.acquire(blocking=False):
        raise ValueError("a document conversion is already running; retry after it completes")
    try:
        return json.dumps(document(ROOT, path, start, max_chars), ensure_ascii=True)
    finally:
        CONVERSION_SLOT.release()


if __name__ == "__main__":
    server.run(transport="stdio")
