"""
Usage quota fetching and storage for Claude Code.

Fetches usage data from the Anthropic OAuth usage API endpoint
using credentials from the system keychain (macOS) or
~/.claude/.credentials.json (Linux), and stores snapshots in the database.

Also provides cost estimation for quota periods by summing
SessionItem costs within the relevant time windows.
"""

import asyncio
import getpass
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
import orjson

from twicc.core.models import SessionItem, UsageSnapshot

logger = logging.getLogger(__name__)

# Anthropic usage API endpoint
USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage"

# Required headers for the usage API
USAGE_API_HEADERS = {
    "Content-Type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "claude-code/2.1.34",
}

# Credentials file path (cross-platform)
CREDENTIALS_PATH = Path.home() / ".claude" / ".credentials.json"

# Track expiresAt values for which a token refresh has already been attempted
# (and failed), to avoid retrying the SDK call for the same stale token.
_failed_refresh_expires: set[int] = set()

# Timeout for the SDK token refresh call
_TOKEN_REFRESH_TIMEOUT = 30


KEYCHAIN_SERVICE = "Claude Code-credentials"


def _read_credentials_data() -> dict | None:
    """
    Read the full credentials dict from the appropriate storage.

    On macOS: tries the system Keychain first (via the ``keyring`` library),
    then falls back to the JSON file.
    On other platforms: reads the JSON file directly.

    Returns the parsed dict, or None if credentials cannot be read.
    """
    if sys.platform == "darwin":
        data = _read_credentials_from_keychain()
        if data is not None:
            return data

    return _read_credentials_from_file()


def _read_credentials_from_keychain() -> dict | None:
    """Read credentials from the macOS Keychain via the ``keyring`` library."""
    try:
        import keyring
    except ImportError:
        logger.debug("keyring library not available, skipping Keychain lookup")
        return None

    try:
        account = os.environ.get("USER") or getpass.getuser()
    except Exception:
        logger.debug("Cannot determine user account for Keychain lookup")
        return None

    try:
        raw = keyring.get_password(KEYCHAIN_SERVICE, account)
    except Exception as e:
        logger.debug("Keychain read failed: %s", e)
        return None

    if not raw:
        return None

    try:
        data = orjson.loads(raw)
    except (orjson.JSONDecodeError, ValueError) as e:
        logger.warning("Failed to parse Keychain credentials JSON: %s", e)
        return None

    return data if isinstance(data, dict) else None


def _read_credentials_from_file() -> dict | None:
    """Read credentials from ~/.claude/.credentials.json."""
    if not CREDENTIALS_PATH.is_file():
        return None

    try:
        data = orjson.loads(CREDENTIALS_PATH.read_bytes())
    except (orjson.JSONDecodeError, OSError):
        return None

    return data if isinstance(data, dict) else None


def has_oauth_credentials() -> bool:
    """
    Check whether OAuth credentials are configured.

    Returns True if the credentials can be read (from Keychain or file)
    and contain a claudeAiOauth entry (regardless of whether the token is valid).
    """
    data = _read_credentials_data()
    if data is None:
        return False

    return bool(data.get("claudeAiOauth"))


def _get_credentials() -> tuple[str, int] | None:
    """
    Read the OAuth access token and expiresAt from credentials storage.

    Returns:
        A (token, expires_at_ms) tuple, or None if not found.
    """
    data = _read_credentials_data()
    if data is None:
        logger.warning("No credentials found (checked %s)", "Keychain + file" if sys.platform == "darwin" else "file")
        return None

    oauth = data.get("claudeAiOauth", {})
    token = oauth.get("accessToken")
    if not token:
        logger.warning("No OAuth access token found in credentials")
        return None

    expires_at = oauth.get("expiresAt", 0)
    return token, expires_at


def _get_expires_at() -> int:
    """Read the current expiresAt value from credentials. Returns 0 if unavailable."""
    data = _read_credentials_data()
    if data is None:
        return 0
    return data.get("claudeAiOauth", {}).get("expiresAt", 0)


def _refresh_token_via_sdk(expires_at: int) -> bool:
    """
    Attempt to refresh the OAuth token by making a throwaway SDK call.

    The SDK automatically refreshes the stored credentials when it connects.
    We send a trivial prompt and discard the response.

    Returns True if the token was refreshed (expiresAt changed), False otherwise.
    """
    if expires_at in _failed_refresh_expires:
        logger.info("Token refresh already attempted for expiresAt=%d, skipping", expires_at)
        return False

    _failed_refresh_expires.add(expires_at)

    logger.info("Attempting token refresh via SDK (current expiresAt=%d)", expires_at)

    try:
        asyncio.run(_sdk_throwaway_call())
    except Exception as e:
        logger.warning("SDK token refresh call failed: %s", e)
        return False

    new_expires_at = _get_expires_at()
    if new_expires_at == expires_at:
        logger.warning("Token was not refreshed by SDK (expiresAt unchanged: %d)", expires_at)
        return False

    logger.info("Token refreshed via SDK: expiresAt %d → %d", expires_at, new_expires_at)
    return True


async def _sdk_throwaway_call() -> None:
    """Make a minimal SDK call to trigger token refresh."""
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage

    options = ClaudeAgentOptions(
        model="haiku",
        permission_mode="default",
        extra_args={"no-session-persistence": None},
        allowed_tools=[],
        effort='low',
    )
    client = ClaudeSDKClient(options=options)

    async def _execute():
        await client.connect()
        await client.query("What model are you?")
        async for msg in client.receive_messages():
            if isinstance(msg, ResultMessage):
                break

    try:
        await asyncio.wait_for(_execute(), timeout=_TOKEN_REFRESH_TIMEOUT)
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def fetch_usage(*, refresh_token_if_needed: bool = True) -> dict | None:
    """
    Fetch usage data from the Anthropic OAuth usage API.

    On 401/403, attempts to refresh the token via a throwaway SDK call,
    then retries the fetch once if the token was actually refreshed.

    Returns:
        The raw JSON response as a dict, or None on failure.
    """
    creds = _get_credentials()
    if creds is None:
        return None

    token, expires_at = creds
    headers = {
        **USAGE_API_HEADERS,
        "Authorization": f"Bearer {token}",
    }

    try:
        response = httpx.get(USAGE_API_URL, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403) and refresh_token_if_needed:
            logger.warning("Usage API returned %d, attempting token refresh", e.response.status_code)
            if _refresh_token_via_sdk(expires_at):
                return fetch_usage(refresh_token_if_needed=False)
            return None
        logger.warning("Usage API HTTP error: %s", e)
        return None
    except httpx.TimeoutException:
        logger.warning("Usage API request timed out")
        return None
    except Exception as e:
        logger.warning("Usage API request failed: %s", e)
        return None


def _extract_quota_fields(data: dict | None, prefix: str) -> dict:
    """
    Extract utilization and resets_at from a quota block.

    Args:
        data: The quota block (e.g., {"utilization": 12.0, "resets_at": "..."}) or None.
        prefix: Field name prefix (e.g., "five_hour").

    Returns:
        Dict with "{prefix}_utilization" and "{prefix}_resets_at" keys.
    """
    if data is None:
        return {
            f"{prefix}_utilization": None,
            f"{prefix}_resets_at": None,
        }

    resets_at_str = data.get("resets_at")
    resets_at = None
    if resets_at_str:
        try:
            resets_at = datetime.fromisoformat(resets_at_str)
        except ValueError:
            logger.warning("Failed to parse resets_at for %s: %s", prefix, resets_at_str)

    return {
        f"{prefix}_utilization": data.get("utilization"),
        f"{prefix}_resets_at": resets_at,
    }


def save_usage_snapshot(raw: dict) -> UsageSnapshot:
    """
    Parse a raw usage API response and save it as a UsageSnapshot.

    Args:
        raw: The raw JSON response from the usage API.

    Returns:
        The created UsageSnapshot instance.
    """
    now = datetime.now(timezone.utc)

    fields = {
        "fetched_at": now,
        "raw_response": raw,
    }

    # Quota blocks
    for key, prefix in [
        ("five_hour", "five_hour"),
        ("seven_day", "seven_day"),
        ("seven_day_opus", "seven_day_opus"),
        ("seven_day_sonnet", "seven_day_sonnet"),
        ("seven_day_oauth_apps", "seven_day_oauth_apps"),
        ("seven_day_cowork", "seven_day_cowork"),
    ]:
        fields.update(_extract_quota_fields(raw.get(key), prefix))

    # Extra usage block
    extra = raw.get("extra_usage")
    if extra is not None:
        fields["extra_usage_is_enabled"] = extra.get("is_enabled", False)
        fields["extra_usage_monthly_limit"] = extra.get("monthly_limit")
        fields["extra_usage_used_credits"] = extra.get("used_credits")
        fields["extra_usage_utilization"] = extra.get("utilization")
    else:
        fields["extra_usage_is_enabled"] = False
        fields["extra_usage_monthly_limit"] = None
        fields["extra_usage_used_credits"] = None
        fields["extra_usage_utilization"] = None

    return UsageSnapshot.objects.create(**fields)


def read_usage_from_file(file_path: str) -> dict | None:
    """
    Read usage data from a local JSON file instead of calling the API.

    The file should contain raw JSON in the same format as the Anthropic
    usage API response (keys like "five_hour", "seven_day", etc.).

    Args:
        file_path: Absolute path to the JSON file.

    Returns:
        The parsed JSON dict, or None on failure.
    """
    path = Path(file_path)
    if not path.is_file():
        logger.warning("Usage JSON file not found: %s", file_path)
        return None

    try:
        return orjson.loads(path.read_bytes())
    except orjson.JSONDecodeError as e:
        logger.warning("Usage JSON file is not valid JSON: %s — %s", file_path, e)
        return None
    except OSError as e:
        logger.warning("Failed to read usage JSON file: %s — %s", file_path, e)
        return None


# Required top-level keys in the usage API response
USAGE_REQUIRED_KEYS = {"five_hour", "seven_day"}


def validate_usage_file(file_path: str) -> tuple[bool, str]:
    """
    Validate that a file exists, is readable, and contains the expected keys.

    Checks: file exists, valid JSON object, has "five_hour" and "seven_day" keys.

    Returns:
        A (valid, message) tuple. If valid is False, message explains the problem.
    """
    path = Path(file_path)

    if not path.is_file():
        return False, "File not found"

    try:
        content = path.read_bytes()
    except OSError as e:
        return False, f"Cannot read file: {e}"

    try:
        data = orjson.loads(content)
    except orjson.JSONDecodeError as e:
        return False, f"Invalid JSON: {e}"

    if not isinstance(data, dict):
        return False, "JSON root must be an object"

    missing = USAGE_REQUIRED_KEYS - data.keys()
    if missing:
        return False, f"Missing required keys: {', '.join(sorted(missing))}"

    return True, "Valid usage file"


def dump_usage_to_file(raw: dict, file_path: str) -> None:
    """
    Write raw usage API response to a JSON file.

    Args:
        raw: The raw JSON response from the usage API.
        file_path: Absolute path to write to.
    """
    try:
        Path(file_path).write_bytes(orjson.dumps(raw, option=orjson.OPT_INDENT_2))
    except OSError as e:
        logger.warning("Failed to dump usage to file: %s — %s", file_path, e)


def validate_usage_dump_path(file_path: str) -> tuple[bool, str]:
    """
    Validate that a dump file path is usable (parent directory exists and is writable).

    Returns:
        A (valid, message) tuple.
    """
    path = Path(file_path)

    if not path.parent.is_dir():
        return False, f"Directory does not exist: {path.parent}"

    if not os.access(path.parent, os.W_OK):
        return False, f"Directory is not writable: {path.parent}"

    return True, "Valid dump path"


def fetch_and_save_usage() -> UsageSnapshot | None:
    """
    Fetch usage data from the API (or from a local JSON file if configured)
    and save a snapshot. Optionally dumps the raw API response to a file.

    Returns:
        The created UsageSnapshot, or None if fetch failed.
    """
    from twicc.synced_settings import read_synced_settings

    settings = read_synced_settings()
    read_enabled = settings.get("usageJsonFileEnabled", False)
    read_path = settings.get("usageJsonFilePath", "")
    dump_enabled = settings.get("usageDumpFileEnabled", False)
    dump_path = settings.get("usageDumpFilePath", "")

    if read_enabled and read_path:
        raw = read_usage_from_file(read_path)
    else:
        raw = fetch_usage()
        # Dump raw response to file if enabled (only when fetching from API)
        if raw is not None and dump_enabled and dump_path:
            dump_usage_to_file(raw, dump_path)

    if raw is None:
        return None

    try:
        return save_usage_snapshot(raw)
    except Exception as e:
        logger.error("Failed to save usage snapshot: %s", e, exc_info=True)
        return None


# Duration of 30 days in seconds, for monthly cost projection
THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60


def _sum_costs_since(start: datetime) -> Decimal:
    """
    Sum all SessionItem costs with timestamp >= start.

    Returns Decimal(0) if no items found.
    """
    from django.db.models import Sum

    result = (
        SessionItem.objects.filter(
            timestamp__gte=start,
            cost__isnull=False,
        )
        .aggregate(total=Sum("cost"))
    )
    return result["total"] or Decimal(0)


def compute_period_costs(snapshot: UsageSnapshot) -> dict:
    """
    Compute cost data for the 5-hour and 7-day quota periods.

    For each period, calculates:
    - spent: actual sum of SessionItem costs since period start (USD)
    - estimated_period: projected cost for the full period, capped at quota cutoff
    - estimated_monthly: projected cost over 30 days, derived from capped period cost
    - capped: whether the period estimate was capped due to burn rate > 1
    - cutoff_at: ISO datetime when quota will be exhausted (null if burn rate <= 1)

    When burn rate > 1.0, usage will hit 100% before the period ends.
    The cost at cutoff is: spent * (100 / utilization).
    After cutoff, no more usage is possible, so cost plateaus.

    The 30-day estimate is derived from the (potentially capped) period cost:
    estimated_monthly = (estimated_period / window_seconds) * 30_days_seconds.
    This correctly models the repeating pattern: if you burn through quota in
    half the window every cycle, you spend the capped amount per window, repeated
    across all windows in 30 days.

    Args:
        snapshot: The usage snapshot containing resets_at times and utilization.

    Returns:
        Dict with keys "five_hour" and "seven_day", each containing:
        - spent (float): actual cost in USD
        - estimated_period (float|None): projected period cost (capped if burn rate > 1)
        - estimated_monthly (float|None): projected 30-day cost
        - capped (bool): True if estimated_period was capped due to quota exhaustion
        - cutoff_at (str|None): ISO datetime when quota will be exhausted, or None
    """
    now = datetime.now(timezone.utc)
    result = {}

    periods = [
        ("five_hour", snapshot.five_hour_resets_at, timedelta(hours=5), snapshot.five_hour_utilization),
        ("seven_day", snapshot.seven_day_resets_at, timedelta(days=7), snapshot.seven_day_utilization),
    ]

    for key, resets_at, window, utilization in periods:
        if resets_at is None:
            result[key] = {
                "spent": 0.0,
                "estimated_period": None,
                "estimated_monthly": None,
                "capped": False,
                "cutoff_at": None,
            }
            continue

        period_start = resets_at - window
        spent = _sum_costs_since(period_start)
        spent_float = float(spent)

        # Time elapsed since period start
        elapsed_seconds = (now - period_start).total_seconds()
        window_seconds = window.total_seconds()

        if elapsed_seconds <= 0 or window_seconds <= 0:
            result[key] = {
                "spent": round(spent_float, 4),
                "estimated_period": None,
                "estimated_monthly": None,
                "capped": False,
                "cutoff_at": None,
            }
            continue

        # Linear projection: cost for the full window at current pace
        rate_per_second = spent_float / elapsed_seconds
        estimated_period_linear = rate_per_second * window_seconds

        # Check if burn rate > 1 (will hit quota before period ends)
        capped = False
        cutoff_at = None  # ISO datetime when quota will be exhausted

        if utilization is not None and utilization > 0:
            # Burn rate = utilization / time_pct
            time_pct = elapsed_seconds / window_seconds
            burn_rate = (utilization / 100.0) / time_pct if time_pct > 0 else 0

            if utilization >= 100:
                # Already exhausted — cost won't grow further
                capped = True
                cutoff_at = now  # already hit
                estimated_period = spent_float
            elif burn_rate > 1.0:
                # Will exhaust before period ends
                # Cost at cutoff = spent * (100 / utilization)
                capped = True
                estimated_period = spent_float * (100.0 / utilization)

                # Time until cutoff: utilization reaches 100% at this pace
                # cutoff_time_pct = 1.0 / burn_rate (fraction of window)
                cutoff_seconds = window_seconds / burn_rate
                remaining_to_cutoff = max(0.0, cutoff_seconds - elapsed_seconds)
                cutoff_at = now + timedelta(seconds=remaining_to_cutoff)
            else:
                estimated_period = estimated_period_linear
        else:
            estimated_period = estimated_period_linear

        # Monthly estimate derived from (capped) period cost
        # This models the repeating cycle: each window costs estimated_period
        estimated_monthly = (estimated_period / window_seconds) * THIRTY_DAYS_SECONDS

        result[key] = {
            "spent": round(spent_float, 4),
            "estimated_period": round(estimated_period, 4),
            "estimated_monthly": round(estimated_monthly, 2),
            "capped": capped,
            "cutoff_at": cutoff_at.isoformat() if cutoff_at else None,
        }

    return result
