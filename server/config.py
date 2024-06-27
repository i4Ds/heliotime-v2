import os
from datetime import datetime, timedelta, timezone

DATABASE_HOST = os.environ.get('DATABASE_HOST', 'localhost')
DATABASE_PORT = os.environ.get('DATABASE_PORT', '5432')
DATABASE_DATABASE = os.environ.get('DATABASE_DATABASE', 'postgres')
DATABASE_USERNAME = os.environ.get('DATABASE_USERNAME', 'postgres')
DATABASE_PASSWORD = os.environ.get('DATABASE_PASSWORD', 'heliotime')
DATABASE_URL = f'postgresql://{DATABASE_USERNAME}:{DATABASE_PASSWORD}@{DATABASE_HOST}/{DATABASE_DATABASE}'

IMPORT_START = datetime.fromisoformat(os.environ['IMPORT_START']).astimezone(timezone.utc) \
    if 'IMPORT_START' in os.environ and len(os.environ['IMPORT_START']) > 0 else \
    datetime.now(tz=timezone.utc) - timedelta(days=30)
