from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0068_migrate_session_settings"),
    ]

    operations = [
        migrations.AddField(
            model_name="session",
            name="compacted",
            field=models.BooleanField(default=False),
        ),
    ]
