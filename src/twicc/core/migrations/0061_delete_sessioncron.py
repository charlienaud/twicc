from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0060_sessioncron'),
    ]

    operations = [
        migrations.DeleteModel(
            name='SessionCron',
        ),
    ]
