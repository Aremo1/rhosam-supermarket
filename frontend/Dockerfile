# ═══════════════════════════════════════════════════════════════════
# RHoSAM Frontend — Production Dockerfile
# Build React app, then serve with Node.js static server
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Serve ───────────────────────────────────────────────
FROM node:20-alpine

RUN addgroup -S rhosam && adduser -S rhosam -G rhosam

WORKDIR /app

# Copy built assets and production server (uses Node built-ins only)
COPY --from=builder /app/dist ./dist
COPY server.js ./

RUN chown -R rhosam:rhosam /app

USER rhosam

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/ || exit 1

CMD ["node", "server.js"]
