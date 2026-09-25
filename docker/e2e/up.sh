#!/usr/bin/env sh
# Starts the local E2E stack, applies our migrations and writes docker/e2e/.env.e2e
set -eu
cd "$(dirname "$0")"
if [ ! -f .env.e2e ]; then
  node keys.mjs > .env.e2e
  echo "POSTGRES_PASSWORD=postgres" >> .env.e2e
fi
set -a; . ./.env.e2e; set +a
docker compose --env-file .env.e2e up -d
echo "waiting for auth schema…"
for i in $(seq 1 60); do
  docker compose exec -T db psql -U postgres -tAc "select to_regclass('auth.users') is not null and exists (select 1 from auth.schema_migrations)" 2>/dev/null | grep -q t && break
  sleep 2
done
echo "waiting for storage schema…"
for i in $(seq 1 60); do
  docker compose exec -T db psql -U postgres -tAc "select count(*) from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='public'" 2>/dev/null | grep -q 1 && break
  sleep 2
done
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:54322/postgres" pnpm --filter @dtn/db migrate
docker compose restart rest >/dev/null
echo "E2E stack ready: http://localhost:54321 (db :54322). Keys in docker/e2e/.env.e2e"
