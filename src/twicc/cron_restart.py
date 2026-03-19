"""
Cron restart: re-launch Claude sessions that had active cron jobs when TwiCC last stopped.

Called once at TwiCC startup, after the file watcher is running (so that JSONL writes
from restarted sessions are detected and synced).
"""

import asyncio
import logging
import os
from collections import defaultdict

logger = logging.getLogger(__name__)

RETRY_DELAYS = [0, 5, 15, 30, 60, 120, 180, 300]


async def restart_all_session_crons() -> None:
    """Scan ProcessRun table and restart all sessions with persisted crons.

    Steps:
    1. Delete orphan process runs (runs with no associated crons)
    2. For sessions with multiple process runs, keep only the oldest (the last confirmed one)
    3. Collect restart data for each remaining session with active crons
    4. Launch all restarts in parallel
    """
    restarts = await asyncio.to_thread(_prepare_restarts)

    if not restarts:
        logger.info("No cron jobs to restart")
        return

    logger.info("Restarting cron jobs for %d session(s)", len(restarts))

    tasks = [restart_session_crons(**r) for r in restarts]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    succeeded = sum(1 for r in results if not isinstance(r, Exception))
    failed = sum(1 for r in results if isinstance(r, Exception))
    for restart_data, result in zip(restarts, results):
        if isinstance(result, Exception):
            logger.error(
                "Cron restart failed for session %s: %s",
                restart_data["session_id"], result,
            )

    logger.info("Cron restart complete: %d succeeded, %d failed", succeeded, failed)


def _prepare_restarts() -> list[dict]:
    """Synchronous DB work: cleanup orphan process runs and collect restart data.

    Called in asyncio.to_thread from restart_all_session_crons().
    """
    from django.db.models import Count

    from twicc.core.models import ProcessRun, SessionCron

    # 1. Delete orphan process runs (no crons attached)
    orphan_count, _ = (
        ProcessRun.objects
        .annotate(cron_count=Count("crons"))
        .filter(cron_count=0)
        .delete()
    )
    if orphan_count:
        logger.info("Cleaned up %d orphan process run(s)", orphan_count)

    # 2. For sessions with multiple process runs, keep only the oldest
    runs_by_session: dict[str, list[ProcessRun]] = defaultdict(list)
    for process_run in ProcessRun.objects.order_by("started_at"):
        runs_by_session[process_run.session_id].append(process_run)

    for session_id, runs in runs_by_session.items():
        if len(runs) > 1:
            # Keep the oldest (index 0), delete all others (cascade deletes their crons)
            stale_pks = [r.pk for r in runs[1:]]
            deleted_count, _ = ProcessRun.objects.filter(pk__in=stale_pks).delete()
            logger.info(
                "Session %s had %d process runs, kept oldest, deleted %d newer one(s)",
                session_id, len(runs), deleted_count,
            )
            runs_by_session[session_id] = [runs[0]]

    # 3. Collect restart data for each session with active crons.
    # Fetch all relevant Session rows in one query for settings and cwd.
    from twicc.core.models import Session
    session_ids = list(runs_by_session.keys())
    sessions_by_id = {
        s.id: s for s in Session.objects.filter(id__in=session_ids)
    }

    restarts = []
    for session_id, runs in runs_by_session.items():
        process_run = runs[0]

        # Check for active crons on this process run
        active_crons = list(
            SessionCron.active_for_session(session_id).filter(process_run=process_run)
        )
        if not active_crons:
            # All crons expired — delete the process run, nothing to restart
            process_run.delete()
            logger.info("Session %s: all crons expired, deleted process run %s", session_id, process_run.pk)
            continue

        # Look up session for cwd and settings
        session = sessions_by_id.get(session_id)
        if session is None:
            logger.warning(
                "Skipping cron restart for session %s: session not found in DB. "
                "Process run %s deleted.",
                session_id, process_run.pk,
            )
            process_run.delete()
            continue

        # Check that the working directory still exists on disk
        cwd = session.cwd
        if not cwd or not os.path.isdir(cwd):
            # Keep the process run (directory might come back later), but skip restart for now
            logger.warning(
                "Skipping cron restart for session %s: cwd '%s' does not exist on disk. "
                "Process run %s kept for future retry.",
                session_id, cwd, process_run.pk,
            )
            continue

        # Build cron data for the restart message
        crons_data = [
            {
                "cron_expr": c.cron_expr,
                "recurring": c.recurring,
                "prompt": c.prompt,
            }
            for c in active_crons
        ]

        restarts.append({
            "session_id": session_id,
            "project_id": session.project_id,
            "cwd": cwd,
            "crons_data": crons_data,
            "permission_mode": session.permission_mode or "default",
            "selected_model": session.selected_model,
            "effort": session.effort,
            "thinking_enabled": session.thinking_enabled,
            "claude_in_chrome": session.claude_in_chrome,
            "context_max": session.context_max,
        })

    return restarts


async def restart_session_crons(
    session_id: str,
    project_id: str,
    cwd: str,
    crons_data: list[dict],
    permission_mode: str,
    selected_model: str | None,
    effort: str | None,
    thinking_enabled: bool | None,
    claude_in_chrome: bool,
    context_max: int,
) -> None:
    """Restart cron jobs for a single session with exponential backoff retry.

    Sends a message to Claude asking it to recreate the crons via CronCreate.
    Waits for the first USER_TURN to confirm success, or retries on failure/timeout.
    """
    from twicc.agent.manager import get_process_manager
    from twicc.agent.states import ProcessState

    manager = get_process_manager()
    message = _build_restart_message(crons_data)

    for attempt, delay in enumerate(RETRY_DELAYS):
        if delay > 0:
            logger.info(
                "Cron restart for session %s: attempt %d/%d in %ds",
                session_id, attempt + 1, len(RETRY_DELAYS), delay,
            )
            await asyncio.sleep(delay)

        try:
            # send_to_session handles "no live process" by creating a resumed process.
            # If a DEAD process exists for this session, it cleans it up first.
            await manager.send_to_session(
                session_id=session_id,
                project_id=project_id,
                cwd=cwd,
                text=message,
                permission_mode=permission_mode,
                selected_model=selected_model,
                effort=effort,
                thinking_enabled=thinking_enabled,
                claude_in_chrome=claude_in_chrome,
                context_max=context_max,
            )

            # Get the process that was just created
            process = manager._processes.get(session_id)
            if process is None:
                logger.warning(
                    "Cron restart for session %s: process not found after send_to_session (attempt %d)",
                    session_id, attempt + 1,
                )
                continue

            # If the process already died during start() (DEAD state), retry
            if process.state == ProcessState.DEAD:
                logger.warning(
                    "Cron restart for session %s: process died immediately (attempt %d)",
                    session_id, attempt + 1,
                )
                continue

            # Wait for first USER_TURN (success) or DEAD (failure)
            try:
                await asyncio.wait_for(
                    process._first_turn_done_event.wait(),
                    timeout=300,  # 5 minutes for Claude to respond
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Cron restart for session %s: timeout waiting for USER_TURN (attempt %d)",
                    session_id, attempt + 1,
                )
                await manager.kill_process(session_id, reason="cron_restart_timeout")
                continue

            # Check outcome
            if process._first_user_turn_reached:
                logger.info("Successfully restarted crons for session %s", session_id)
                return
            else:
                # Process died (DEAD) — ProcessRun cleanup already handled by _on_state_change
                logger.warning(
                    "Cron restart for session %s: process died before USER_TURN (attempt %d)",
                    session_id, attempt + 1,
                )
                continue

        except Exception as e:
            logger.error(
                "Cron restart for session %s: unexpected error (attempt %d): %s",
                session_id, attempt + 1, e,
            )
            continue

    # All attempts exhausted
    logger.error(
        "Failed to restart crons for session %s after %d attempts. "
        "Crons remain in DB for next TwiCC startup.",
        session_id, len(RETRY_DELAYS),
    )


def _build_restart_message(crons_data: list[dict]) -> str:
    """Build the user message asking Claude to recreate cron jobs."""
    lines = [
        "Please recreate the following cron jobs using CronCreate for each one:",
        "",
    ]
    for i, cron in enumerate(crons_data, 1):
        kind = "recurring" if cron["recurring"] else "one-shot"
        lines.append(f'{i}. Schedule: `{cron["cron_expr"]}` ({kind})')
        lines.append(f'   Prompt: "{cron["prompt"]}"')
        lines.append("")

    lines.append("Use the exact schedule and prompt shown above for each CronCreate call.")
    return "\n".join(lines)
