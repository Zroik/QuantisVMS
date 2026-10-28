FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable pnpm

# Copy root configs for workspace resolution
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps/api-server/package.json ./apps/api-server/package.json

RUN pnpm --filter @vms/api-server install --prod

# Copy compiled dist
COPY apps/api-server/dist ./apps/api-server/dist

WORKDIR /app/apps/api-server

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
  CMD curl -f http://localhost:3000/healthz || exit 1

CMD ["node", "dist/index.js"]

