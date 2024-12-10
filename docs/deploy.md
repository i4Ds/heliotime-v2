# Deployment

Heliotime can be deployed in production using Docker Compose.

First provide the necessary [configuration](../README.md#configuration), for example via a `.env` file:

```sh
DATABASE_PASSWORD=<password>
IMPORT_START=1980-01-01
NEXT_PUBLIC_API_URL=https://example.org/api
```

Then deploy everything:

```sh
./du.sh prod deploy
```

It is advised to put both the API and site behind a reverse proxy to add HTTPS and virtual hosts. Here is an example Nginx configuration:

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
   
   # Various security related headers
   add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src *";
   add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
   add_header X-Content-Type-Options nosniff;
   add_header X-Frame-Options SAMEORIGIN;

   # Site endpoint
   location / {
      proxy_pass http://localhost:3000;
      include proxy_params;
   }

   # API endpoint (in this case as a subdirectory)
   location /api/ {
      # Remove the /api prefix
      rewrite ^/api/(.*)$ /$1 break;
      proxy_pass http://localhost:8000;
      include proxy_params;
   }
}
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
