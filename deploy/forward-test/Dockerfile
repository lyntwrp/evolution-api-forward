# Build from this checkout; do not substitute an upstream or third-party API image.
FROM node:24-alpine AS builder

RUN apk add --no-cache git ffmpeg bash openssl
WORKDIR /evolution

COPY package.json package-lock.json ./
# Keep the official locked dependency installation, including required native scripts.
RUN HUSKY=0 npm ci --no-audit --no-fund

COPY tsconfig.json tsup.config.ts runWithProvider.js ./
COPY src ./src
COPY prisma ./prisma
COPY public ./public
# Use the tracked Manager bundle (R2 source/provenance: manager-customization/).
COPY manager ./manager

# Prisma generation validates a URI but does not connect to this dummy database.
# No application .env, runtime key, or real database credential enters the image.
RUN DATABASE_PROVIDER=postgresql \
    DATABASE_CONNECTION_URI=postgresql://build:build@localhost:5432/build \
    npm run db:generate
# The server runs dist/main.js; avoid separately bundling every module in CJS and ESM.
# CLI overrides retain the official loaders and translation-copy hook.
RUN npm exec --no -- tsc --noEmit \
    && npm exec --no -- tsup src/main.ts --format cjs --no-sourcemap

FROM node:24-alpine AS final

RUN apk add --no-cache tzdata ffmpeg bash openssl
WORKDIR /evolution

ARG SOURCE_REVISION=local
LABEL org.opencontainers.image.title="Evolution API v2.3.7 forwardMessage test" \
      org.opencontainers.image.version="2.3.7-forward-test" \
      org.opencontainers.image.revision="$SOURCE_REVISION" \
      io.evolution.forward-test.upstream-revision="cd800f2976e1e5b682fbf86a01ee4d85ae61f370"

COPY --from=builder /evolution/package.json /evolution/package-lock.json ./
COPY --from=builder /evolution/node_modules ./node_modules
COPY --from=builder /evolution/dist ./dist
COPY --from=builder /evolution/prisma ./prisma
COPY --from=builder /evolution/manager ./manager
COPY --from=builder /evolution/public ./public
COPY --from=builder /evolution/runWithProvider.js ./runWithProvider.js

ENV DOCKER_ENV=true \
    DATABASE_PROVIDER=postgresql \
    TZ=America/Mexico_City
EXPOSE 8080

# Use the locked Prisma CLI. The upstream shell wrapper prints DATABASE_URL.
# Generate once during build; migrate only this stack's PostgreSQL at startup.
ENTRYPOINT ["/bin/sh", "-c", "npm run db:deploy && exec npm run start:prod"]
