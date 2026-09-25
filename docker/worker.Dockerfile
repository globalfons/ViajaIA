# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @dtn/worker...

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /repo ./
COPY --chown=app:app packages ./packages
COPY --chown=app:app apps/worker ./apps/worker
COPY --chown=app:app supabase ./supabase
USER app
CMD ["pnpm", "--filter", "@dtn/worker", "start"]
