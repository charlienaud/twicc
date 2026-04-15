"""File content business logic: read and write file contents for the code viewer/editor.

Extracted following the same pattern as file_tree.py — views stay thin HTTP wrappers.
"""

import base64
import os

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB

# Mapping of image file extensions to MIME types.
# When a binary file matches one of these, its content is returned as a data URI.
IMAGE_EXTENSIONS = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def _get_image_src(file_path, size):
    """Return a data URI for the image file, or None if not an image or too large."""
    ext = os.path.splitext(file_path)[1].lower()
    mime_type = IMAGE_EXTENSIONS.get(ext)
    if not mime_type:
        return None
    try:
        with open(file_path, "rb") as f:
            raw = f.read()
    except OSError:
        return None
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def get_file_content(file_path):
    """Read a file and return its content as a dict.

    Returns:
        {
            "content": str,       # file content (absent if binary)
            "size": int,          # file size in bytes
            "binary": bool,       # True if file is binary
            "image_src": str,     # data URI for image files (only when binary + image)
            "error": str | None,  # error message if any
        }

    Handles:
    - Files too large (>5MB): returns error
    - Binary files (UTF-8 decode fails): returns binary=True, no content
      - If the file is a known image type, also returns image_src as a data URI
    - Normal text files: returns content + size
    """
    try:
        size = os.path.getsize(file_path)
    except OSError:
        return {"error": "Cannot read file", "size": 0, "binary": False}

    if size > MAX_FILE_SIZE:
        return {
            "error": f"File too large ({size / 1024 / 1024:.1f} MB, max {MAX_FILE_SIZE / 1024 / 1024:.0f} MB)",
            "size": size,
            "binary": False,
        }

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        result = {"content": None, "size": size, "binary": True}
        image_src = _get_image_src(file_path, size)
        if image_src:
            result["image_src"] = image_src
        return result
    except OSError:
        return {"error": "Cannot read file", "size": size, "binary": False}

    writable = os.access(file_path, os.W_OK)
    return {"content": content, "size": size, "binary": False, "writable": writable}


def write_file_content(file_path, content):
    """Write content to an existing file.

    Returns:
        {"ok": True} on success
        {"error": str} on failure

    Handles:
    - Content too large (>5MB): returns error
    - File does not exist: returns error
    - Permission / OS errors: returns error
    """
    if not os.path.isfile(file_path):
        return {"error": "File not found"}

    content_bytes = content.encode("utf-8")
    if len(content_bytes) > MAX_FILE_SIZE:
        return {
            "error": f"Content too large ({len(content_bytes) / 1024 / 1024:.1f} MB, max {MAX_FILE_SIZE / 1024 / 1024:.0f} MB)"
        }

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        return {"error": f"Cannot write file: {e}"}

    return {"ok": True}
