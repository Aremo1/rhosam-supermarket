# ═══════════════════════════════════════════════════════════════════
# RHoSAM Backend — Production Dockerfile
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine

# Security: run as non-root
RUN addgroup -S rhosam && adduser -S rhosam -G rhosam

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Create uploads directory
RUN mkdir -p uploads && chown -R rhosam:rhosam /app

USER rhosam

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "src/server.js"]
