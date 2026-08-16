# syntax=docker/dockerfile:1
#
# Researchio production image.
#
# Multi-stage so the final image carries only the runtime: no build toolchain,
# no dev dependencies, no source. Node 22 on Alpine keeps it small while
# meeting the Node 20.9+ floor Next.js 16 requires.
#
# The database and uploaded files live on a mounted volume at /data, never
# inside the image — see docker-compose.yml. Anything written to the container
# filesystem is lost on the next deploy.

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Alpine's musl needs this for some native postinstall steps.
RUN apk add --no-cache libc6-compat

# Copied before the source so this layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
COPY prisma ./prisma

# `npm ci` runs the postinstall hook, which generates the Prisma client.
RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js reads the datasource at build time for type generation only; no real
# database is contacted. A placeholder keeps the build hermetic.
ENV DATABASE_URL="file:./build-placeholder.db"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Persistent state. Both paths must be backed by the mounted volume.
ENV DATABASE_URL="file:/data/researchio.db"
ENV UPLOAD_DIR="/data/uploads"
ENV SECURE_COOKIES=1

# Resolves relative paths deterministically regardless of working directory.
ENV PROJECT_ROOT=/app

RUN apk add --no-cache libc6-compat \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone bundle plus the assets it does not inline.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations and the Prisma CLI are needed at boot to bring the volume's
# database up to date. The engine binaries must come along or the CLI cannot
# run in this image.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Created here so the directory exists even before a volume is attached.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

# Verifies the process can actually reach its database, not merely that it is
# listening. See src/app/api/health/route.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
