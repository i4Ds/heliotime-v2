import os
from datetime import datetime, timedelta, timezone

DATABASE_HOST = os.environ.get('DATABASE_HOST', 'localhost')
DATABASE_PORT = os.environ.get('DATABASE_PORT', '5432')
DATABASE_DATABASE = os.environ.get('DATABASE_DATABASE', 'postgres')
DATABASE_USERNAME = os.environ.get('DATABASE_USERNAME', 'postgres')
DATABASE_PASSWORD = os.environ.get('DATABASE_PASSWORD', 'heliotime')
DATABASE_URL = f'postgresql://{DATABASE_USERNAME}:{DATABASE_PASSWORD}@{DATABASE_HOST}/{DATABASE_DATABASE}'
DATABASE_MEMORY_GB = int(os.environ.get('DATABASE_MEMORY_GB', 28))

IMPORT_START = datetime.fromisoformat(os.environ['IMPORT_START']).astimezone(timezone.utc) \
    if 'IMPORT_START' in os.environ and len(os.environ['IMPORT_START']) > 0 else \
    datetime.now(tz=timezone.utc) - timedelta(days=30)

FLUX_MAX_RESOLUTION = int(os.environ.get('FLUX_MAX_RESOLUTION', 2000))
FLUX_QUERY_TIMEOUT = timedelta(seconds=float(os.environ.get('FLUX_QUERY_TIMEOUT', 30)))

# Used when running api in Gunicorn workers
ONLY_API = os.environ.get('ONLY_API', '').lower() == 'true'
