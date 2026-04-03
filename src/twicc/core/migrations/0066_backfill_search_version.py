"""Backfill search_version for sessions already indexed by the watcher.

The watcher was indexing sessions into Tantivy but never setting search_version
on the Session row, leaving it NULL. This caused the background task to
unnecessarily re-index those sessions on every server restart.

Now that the watcher sets search_version inline, this migration backfills
CURRENT_SEARCH_VERSION for all sessions that still have search_version IS NULL,
so existing installations don't trigger a full re-index on next startup.
"""

from django.conf import settings
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0065_delete_sidechain_sessions"),
    ]

    operations = [
        migrations.RunSQL(
            sql=f"UPDATE core_session SET search_version = {settings.CURRENT_SEARCH_VERSION} WHERE search_version IS NULL",
            reverse_sql="UPDATE core_session SET search_version = NULL WHERE search_version IS NOT NULL",
        ),
    ]
