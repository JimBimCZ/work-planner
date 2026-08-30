FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
ENV DOCKER_BUILD=1
# next build imports lib/auth.ts, and Auth.js constructs its providers on
# import — it will not build one without an id and secret. Build-stage only:
# these never reach the runner, and a build must not depend on real secrets.
ENV AUTH_SECRET=build-only \
    AUTH_GOOGLE_ID=build-only \
    AUTH_GOOGLE_SECRET=build-only \
    AUTH_GITHUB_ID=build-only \
    AUTH_GITHUB_SECRET=build-only
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
