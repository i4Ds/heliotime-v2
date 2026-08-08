# Security Policy

## Supported versions

Only the `main` branch of [i4Ds/heliotime-v2](https://github.com/i4Ds/heliotime-v2) is maintained. Deploy from a recent `main` commit and rebuild Docker images after dependency updates.

## Reporting a vulnerability

Please report security issues privately to the [i4Ds](https://github.com/i4Ds) maintainers via GitHub Security Advisories for this repository:

https://github.com/i4Ds/heliotime-v2/security/advisories/new

If advisories are unavailable, open a minimal private contact through the organization maintainers and do **not** file a public issue with exploit details.

## Keeping the stack updated

This project is intended to stay current:

- Dependabot opens weekly PRs for npm, Docker images, and GitHub Actions (see `.github/dependabot.yml`).
- The `Keep updated` workflow builds the site, runs `yarn audit`, validates Compose files, and checks that `server/conda-lock.yml` matches `server/environment.yml`.
- After merging updates, redeploy production with `./du.sh prod deploy` so running containers match the repo.

Operators should apply Dependabot PRs promptly, especially for Next.js, React, FastAPI/Starlette, and base images.
