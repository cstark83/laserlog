# LaserLog — self-hosted laser settings library.
# Debian-slim rather than Alpine: better-sqlite3 ships glibc prebuilds, so the
# image builds fast and reliably on amd64 and arm64 alike.

# ---------- build ----------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Toolchain, in case a prebuilt binary isn't available for this architecture.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="LaserLog" \
      org.opencontainers.image.description="Self-hosted laser settings library with an installable phone app" \
      org.opencontainers.image.source="https://github.com/YOUR_GITHUB_USERNAME/laserlog" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    AUTH=on \
    PUID=99 \
    PGID=100

VOLUME ["/data"]
EXPOSE 8080

# Uses the app's own /healthz, so no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["entrypoint"]
CMD ["node", "server/index.js"]
