FROM alpine:3 AS visx-copier

WORKDIR /app
COPY visx/package.json .
COPY visx/yarn.lock .
# Only copy package.json files
COPY visx/packages ./packages
RUN find packages ! -name "package.json" -mindepth 2 -maxdepth 2 -print0 | xargs -0 rm -rf

FROM node:22-bullseye AS builder

# Build Visx
WORKDIR /app/visx
COPY --from=visx-copier /app .
RUN --mount=type=cache,target=/usr/local/share/.cache yarn install --frozen-lockfile
COPY visx .
RUN yarn build

ENV NEXT_TELEMETRY_DISABLED 1
WORKDIR /app

# Install dependencies
COPY package.json .
COPY yarn.lock .
RUN --mount=type=cache,target=/usr/local/share/.cache yarn install --frozen-lockfile --ignore-engines

# Build server
COPY src ./src
COPY mdx-components.tsx .
COPY next.config.mjs .
COPY postcss.config.mjs .
COPY tailwind.config.ts .
COPY tsconfig.json .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL $NEXT_PUBLIC_API_URL
RUN --mount=type=cache,target=/usr/local/share/.cache yarn build

FROM gcr.io/distroless/nodejs22-debian12:latest

ENV NEXT_TELEMETRY_DISABLED 1
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

CMD ["./server.js"]
