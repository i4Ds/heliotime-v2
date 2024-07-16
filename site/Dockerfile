FROM node:22-bullseye AS builder

ENV NEXT_TELEMETRY_DISABLED 1
WORKDIR /app

COPY visx ./visx
RUN --mount=type=cache,target=/usr/local/share/.cache cd visx && yarn install --frozen-lockfile && yarn build

COPY package.json .
COPY yarn.lock .
RUN --mount=type=cache,target=/usr/local/share/.cache yarn install --frozen-lockfile --ignore-engines

COPY src ./src
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
