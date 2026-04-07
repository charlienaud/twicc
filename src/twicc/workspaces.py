"""
Read/write workspaces from/to workspaces.json in the data directory.

Workspaces group projects into named collections with optional layout and
filter configuration. They are stored as a simple JSON object in
<data_dir>/workspaces.json.

Follow the exact same pattern as synced_settings.py.
"""

import os
import tempfile

import orjson

from twicc.paths import get_workspaces_path


def read_workspaces() -> dict:
    """Read workspaces from workspaces.json.

    Returns an empty dict if the file doesn't exist or is invalid.
    """
    path = get_workspaces_path()
    try:
        return orjson.loads(path.read_bytes())
    except (FileNotFoundError, orjson.JSONDecodeError):
        return {}


def write_workspaces(data: dict) -> None:
    """Write workspaces to workspaces.json atomically.

    Uses write-to-temp-then-rename to avoid partial writes.
    """
    path = get_workspaces_path()
    content = orjson.dumps(data, option=orjson.OPT_INDENT_2)

    # Write to a temp file in the same directory, then atomically replace.
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
