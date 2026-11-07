FROM vms-transcode-worker:latest

USER root
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

RUN id -u appuser >/dev/null 2>&1 || useradd -u 10001 -m -s /bin/sh appuser \
    && mkdir -p /data/raw \
    && chown -R appuser:appuser /app /data

WORKDIR /app/services/media-engine/recorder
USER appuser

ENTRYPOINT []
CMD ["node", "dist/main.js"]
