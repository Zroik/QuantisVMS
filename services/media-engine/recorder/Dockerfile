FROM vms-transcode-worker:latest

ENV NODE_ENV=production
WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# Copy root configs for workspace resolution
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY services/media-engine/recorder/package.json ./services/media-engine/recorder/package.json

RUN pnpm --filter @vms/recorder install --prod

# Copy compiled dist
COPY services/media-engine/recorder/dist ./services/media-engine/recorder/dist

WORKDIR /app/services/media-engine/recorder

ENTRYPOINT []
CMD ["node", "dist/main.js"]

