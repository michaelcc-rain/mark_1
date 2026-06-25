"""Locate and load the Rain OpenAPI schema for the find/show helpers.

Unlike some vendors, **Rain's OpenAPI spec is NOT served on a public URL** —
the docs site (https://docs.rain.xyz) is login-gated and redirects an
unauthenticated `GET /openapi.json` to a login page. So this helper does
*not* auto-fetch from the internet by default. You point it at a local copy
of `openapi.json` instead.

Where to get `openapi.json`:
  - Export / download it from the Rain developer docs while signed in, or
  - Ask your Rain contact for the current `openapi.json`, or
  - Use the copy already vendored in your Rain docs checkout.

Resolution order (first match wins):
  1. $RAIN_OPENAPI            — absolute path to a local schema file.
  2. $RAIN_OPENAPI_URL        — a URL to fetch from (only if YOU have a
                                reachable, authenticated mirror). Cached.
  3. Cached copy at ~/.cache/rain/openapi.json, if present and (when fetched
     via a URL) still fresh.
  4. A short list of common local paths (see _CANDIDATE_PATHS) — convenience
     for the typical docs-checkout layout.

If none resolve, the helper exits with an actionable message telling you to
set $RAIN_OPENAPI.

Environment:
  RAIN_OPENAPI            optional — absolute path to a local schema file
                          (bypasses cache + fetch entirely).
  RAIN_OPENAPI_URL        optional — fetch the spec from this URL (your own
                          authenticated mirror). Result is cached.
  RAIN_SCHEMA_REFRESH=1   optional — force re-fetch from $RAIN_OPENAPI_URL
                          even if a fresh cache exists.
  XDG_CACHE_HOME          optional — override base cache dir (default: ~/.cache).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CACHE_TTL_SECONDS = 24 * 60 * 60  # 1 day

# Convenience: common local layouts where an openapi.json tends to live.
# Set RAIN_OPENAPI to point at your local Rain OpenAPI spec for any other layout.
_CANDIDATE_PATHS = [
    Path.cwd() / "openapi.json",
    Path.cwd() / "rain-platform-docs" / "openapi.json",
]


def schema_url() -> str | None:
    return os.environ.get("RAIN_OPENAPI_URL")


def cache_path() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "rain" / "openapi.json"


def _is_fresh(path: Path) -> bool:
    if not path.is_file():
        return False
    return (time.time() - path.stat().st_mtime) < CACHE_TTL_SECONDS


def _fetch_or_none(url: str) -> bytes | None:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"warning: schema fetch from {url} failed: {exc}", file=sys.stderr)
        return None


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".tmp.{os.getpid()}")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _parse(data: bytes, source: str) -> dict:
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as exc:
        sys.exit(f"error: {source} is not valid JSON ({exc}); first 200 bytes: {data[:200]!r}")
    if not parsed.get("openapi"):
        sys.exit(
            f"error: {source} did not look like an OpenAPI document (no 'openapi' field). "
            "Rain's docs site is login-gated — if you fetched a URL you may have saved a login "
            "HTML page instead of the spec."
        )
    return parsed


def load_schema() -> dict:
    """Return the parsed Rain OpenAPI schema, resolving per the order above."""
    # 1. Explicit local file — highest priority.
    override = os.environ.get("RAIN_OPENAPI")
    if override:
        p = Path(override)
        if not p.is_file():
            sys.exit(f"error: RAIN_OPENAPI={override} is not a file")
        return _parse(p.read_bytes(), f"RAIN_OPENAPI={override}")

    cache = cache_path()
    url = schema_url()

    # 2. Authenticated-mirror URL, if the user set one.
    if url:
        force = os.environ.get("RAIN_SCHEMA_REFRESH") == "1"
        if not force and _is_fresh(cache):
            return _parse(cache.read_bytes(), f"cache {cache}")
        data = _fetch_or_none(url)
        if data is not None:
            parsed = _parse(data, url)
            _atomic_write(cache, data)
            return parsed
        if cache.is_file():
            print(f"warning: using stale schema cache at {cache}", file=sys.stderr)
            return _parse(cache.read_bytes(), f"stale cache {cache}")
        sys.exit(f"error: could not fetch schema from {url} and no cache exists at {cache}.")

    # 3. Any existing cache (e.g. written by a previous RAIN_OPENAPI_URL run).
    if cache.is_file():
        return _parse(cache.read_bytes(), f"cache {cache}")

    # 4. Common local layouts.
    for cand in _CANDIDATE_PATHS:
        if cand.is_file():
            return _parse(cand.read_bytes(), f"local {cand}")

    sys.exit(
        "error: no Rain OpenAPI spec found.\n"
        "Rain's spec is not served on a public URL, so point this helper at a local copy:\n"
        "  export RAIN_OPENAPI=/abs/path/to/openapi.json\n"
        "Get the spec by downloading it from the Rain developer docs (while signed in) "
        "or by asking your Rain contact for the current openapi.json."
    )
