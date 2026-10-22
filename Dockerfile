# Bun is only used to install dependencies from bun.lock (the repo has no
# package-lock.json). The app itself is built and run on Node.
FROM oven/bun:1.4.3-slim AS bun

# ---------- Build stage ----------
FROM node:22.23.4-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy package files (bunfig.toml enforces ignoreScripts + minimumReleaseAge)
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY tsconfig.json ./

# Install dependencies exactly as locked
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src

# Build the application
RUN bun run build

# ---------- Production dependencies ----------
FROM builder AS prod-deps

RUN rm -rf node_modules \
    && bun install --frozen-lockfile --production

# ---------- Production stage ----------
FROM node:22.23.4-slim

# Refresh the system CA store (eMudhra intermediate distrust)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for cache persistence (non-root "node" user, uid 1000)
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
