# Despliegue

## 1. Supabase

### Local
```bash
supabase init            # solo la primera vez (ya existe supabase/migrations)
supabase start           # imprime API URL, anon key, service_role key y DB URL
supabase db reset        # aplica supabase/migrations/*
```
Copia los valores a `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL`.

### Cloud (staging/producción)
1. Crea el proyecto en **región UE** (RGPD).
2. `supabase link --project-ref <ref>` y después `supabase db push`.
3. En Auth → URL Configuration: *Site URL* = `APP_URL`; *Redirect URLs* = `APP_URL/auth/callback`.
4. Activa la confirmación de email (las invitaciones dependen de que el email esté verificado).

### Primer administrador de plataforma
1. Crea tu usuario (Supabase Studio → Authentication → Add user, o *invite*).
2. En el SQL editor:
   ```sql
   update public.profiles set is_platform_admin = true where email = 'tu@email.com';
   ```
3. Entra en `/admin` y crea el primer cliente en `/clients`.

## 2. Aplicación web
- **Vercel**: *root* `apps/web`, *build* `pnpm --filter @dtn/web build`. Variables de entorno según `.env.example`
  con `APP_ENV=production`.
- **Contenedor**: `docker build -f docker/web.Dockerfile .` (salida *standalone*, usuario sin privilegios).

## 3. Worker
Contenedor `docker/worker.Dockerfile` en un VPS o cloud con las mismas variables de servidor.

## 4. Verificación
```bash
pnpm typecheck && pnpm test && pnpm --filter @dtn/web build
docker compose --profile test up -d testdb
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/dtn_test pnpm --filter @dtn/db test
```
