"""Set custom_title items to DEBUG_ONLY display level.

Claude CLI re-writes custom-title entries to the JSONL file on every session
resume, producing noisy duplicates. These items carry no user-visible value
beyond the initial title set, so they belong in DEBUG_ONLY (3) rather than
COLLAPSIBLE (2).
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0063_session_last_new_content_at_last_viewed_at"),
    ]

    operations = [
        migrations.RunSQL(
            sql="UPDATE core_sessionitem SET display_level = 3 WHERE kind = 'custom_title' AND display_level != 3",
            reverse_sql="UPDATE core_sessionitem SET display_level = 2 WHERE kind = 'custom_title' AND display_level = 3",
        ),
    ]
