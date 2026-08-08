# Deployment

Heliotime can be deployed in production using Docker Compose.

First provide the necessary [configuration](../README.md#configuration), for example via a `.env` file:

```sh
DATABASE_PASSWORD=<strong-unique-password>
IMPORT_START=1980-01-01
NEXT_PUBLIC_API_URL=https://example.org/api
CORS_ORIGINS=https://example.org
ENV=prod

# Optimize database for 10 GB of memory
DATABASE_MEMORY_GB=10
DATABASE_ARGS="-c shared_buffers=3GB -c max_wal_size=3GB"
```

Then deploy everything:

```sh
./du.sh prod deploy
```

After a compromise or suspected image tampering, set a **new** `DATABASE_PASSWORD`, pull/rebuild all images (`./du.sh prod deploy` with `--build` / no cache if needed), and redeploy from a clean checkout. Do not reuse old container layers you do not trust.

## Network exposure

Production Compose does **not** publish Postgres to the host. Only the API (`API_PORT`, default 8000) and site (`SITE_PORT`, default 3000) are published for the reverse proxy.

Hardening checklist:

- Firewall / security group: allow **only** 80/443 from the internet.
- Bind or firewall **3000**, **8000**, and **5432** so they are not reachable from the public internet (localhost or private Docker network only).
- Terminate TLS at Nginx (or similar); do not expose the Node/FastAPI ports directly.
- Set `CORS_ORIGINS` to the public site origin(s), comma-separated. Do not use `*`.
- OpenAPI UI (`/docs`, `/redoc`) is disabled when `ENV=prod`.

## Reverse proxy

Put both the API and site behind a reverse proxy for HTTPS and virtual hosts. Example Nginx configuration:

```nginx
# HTTP to HTTPS redirect
server {
   listen 80;
   server_name example.org;
   # Ensure client uses HTTPS in the future
   add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
   return 301 https://$host$request_uri;
}

# HTTPS endpoint
server {
   listen 443 ssl;

   # SSL configuration (for example via Certbot)
   ssl_certificate /etc/letsencrypt/live/example.org/fullchain.pem;
   ssl_certificate_key /etc/letsencrypt/live/example.org/privkey.pem;
   include /etc/letsencrypt/options-ssl-nginx.conf;
   ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

   server_name example.org;

   # Security headers. Next.js may still need 'unsafe-inline' for styles/scripts
   # depending on the build; tighten further if you move to nonces.
   add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://example.org; frame-src https://helioviewer.org https://www.helioviewer.org";
   add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
   add_header X-Content-Type-Options nosniff;
   add_header X-Frame-Options SAMEORIGIN;
   add_header Referrer-Policy strict-origin-when-cross-origin;

   # Site endpoint
   location / {
      proxy_pass http://127.0.0.1:3000;
      include proxy_params;
   }

   # API endpoint (in this case as a subdirectory)
   location /api/ {
      # Remove the /api prefix
      rewrite ^/api/(.*)$ /$1 break;
      proxy_pass http://127.0.0.1:8000;
      include proxy_params;
   }
}
```

## Keeping dependencies updated

Automated updates are configured in GitHub:

- **Dependabot** (`.github/dependabot.yml`) opens PRs for npm (`site/`), Docker base images, and GitHub Actions.
- **Weekly CI** (`.github/workflows/keep-updated.yml`) installs/builds the site, runs `yarn audit`, and regenerates a conda-lock PR check when `server/environment.yml` changes.

After merging Dependabot or manual bumps, redeploy with `./du.sh prod deploy` so production runs the new images.

TimescaleDB stays on `2.18.1-pg16` until Alembic continuous-aggregate refresh steps are updated for newer Timescale releases.

For the Conda server lockfile, from `server/`:

```sh
conda-lock -f environment.yml -p linux-64 -p linux-aarch64 --lockfile conda-lock.yml
```

## Analytics

Heliotime does not have built-in analytics but most reverse proxy logs can be analyzed using [GoAccess](https://goaccess.io/):

```sh
# Unpack all log files (if necessary)
gzip -d access.log.*.gz

# Only show flux api requests to filter out most bots
# and get an idea of how much a visitor panned around (optional)
sed -i '/\/api\/flux/!d' access.log*
# Only show traffic from the deployed website (optional)
sed -i '/heliotime.org/!d' access.log*

# Generate report
goaccess access.log* --output=report.html --log-format=combined --ignore-crawlers --geoip-database="/path/to/GeoLite2-Country.mmdb" --geoip-database="/path/to/GeoLite2-City.mmdb" --geoip-database="/path/to/GeoLite2-ASN.mmdb"
```

Use web search to find the MaxMind GeoLite2 database or omit the parameter.
