# Supabase

Local dev runs against a **local Supabase stack** (Supabase CLI + Docker), not the production project. It is free and fully isolated — local testing never writes prod data. (A cloud non-prod project was declined: on the Pro plan every project bills compute, ~$10/mo.)

## Prerequisites

- **Docker Desktop** running
- **Supabase CLI** (developed against 2.117.0)

## Commands

| Command | What it does |
|---|---|
| `npm run db:start` | `supabase start` — boots the stack, applies migrations + seed (cold start ~30s) |
| `npm run db:stop` | `supabase stop` |
| `npm run db:reset` | Re-applies all migrations + `seed.sql`. **Wipes local data.** |
| `npm run db:status` | Shows running services, URLs, and keys |

`db:start` is not chained into `npm run dev` — run it first, then `npm run dev`.

## Local endpoints

| Service | URL |
|---|---|
| API | `http://127.0.0.1:54321` |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Mailpit (local inbox for magic-link emails) | `http://127.0.0.1:54324` |

Run `supabase status -o env` to get the local `SERVICE_ROLE_KEY` and `ANON_KEY` for `.env` (well-known local demo keys, not secrets). In prod, `SUPABASE_SERVICE_ROLE_KEY` holds a Supabase secret key (`sb_secret_…`) stored as a Vercel Secret; the variable name is kept for compatibility and the key stays server-only and RLS-bypassing. `EXPO_PUBLIC_SUPABASE_ANON_KEY` holds a publishable key (`sb_publishable_…`) in prod (name kept for compatibility), and the project's legacy JWT keys (`anon` + `service_role`) are disabled. Set `SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321`. Prod values are kept in `.env.prod-reference` (gitignored).

**Native devices:** iOS Simulator reaches `127.0.0.1`; Android emulator needs `10.0.2.2:54321`; a physical phone needs the Mac's LAN IP in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_DOMAIN`.

## Test user and auth

`config.toml` configures local auth: invite-only, site URL `http://localhost:8081`, redirects `http://localhost:8081/**` and `scoreslinger://**`.

- Invite-only comes from **`[auth] enable_signup = false`**.
- Leave **`[auth.email] enable_signup = true`**. In CLI 2.x, setting it to `false` disables email login entirely, and magic links fail with "Email logins are disabled".
- The local mail catcher is the `[local_smtp]` section (Mailpit, port 54324).

`seed.sql` creates a confirmed user **`dev@local.test`** plus 2 fake scores. Sign in with a magic link and open it from Mailpit. For scripts and curl, the seed user also has the local-only password `devpassword` (password grant on `/auth/v1/token`). Prod users don't exist locally. To add another local user: Studio → Authentication → Add user (auto-confirm).

## Migrations (schema source of truth)

| File | Description |
|---|---|
| `migrations/20260101000000_scores_table.sql` | Creates the `scores` table and enables RLS |
| `migrations/20260101000001_storage_bucket_and_policies.sql` | Creates the private `scores` bucket and its storage RLS policies |

These mirror live prod exactly. Prod's existing schema predates the migrations folder, so they are not applied to prod. The bucket is created in SQL — no manual dashboard step.

### Adding a migration

1. `supabase migration new <name>`
2. Write the SQL in the new file under `migrations/`
3. Test locally: `npm run db:reset`
4. Apply to prod via the dashboard SQL Editor (or Supabase MCP `apply_migration`)
5. Update `shared/schema.ts` and `toScore()` in `server/app.ts` to match

Optional drift check against prod: `supabase link --project-ref <your-project-ref> && supabase db diff --linked`. Never run `supabase db reset --linked` — it wipes the linked database.

## Seed data

`seed.sql` runs on `db:start` (first boot) and every `db:reset`: the `dev@local.test` user and 2 fake scores.

## Notes

- Schema is intentionally simple — no triggers, functions, or complex policies
- RLS is enabled on `scores` but no row-level policies are defined; access is controlled at the API layer via JWT + the server-only admin key (`SUPABASE_SERVICE_ROLE_KEY`)
- The `objective_scores`, `players`, and `player_names` columns use JSONB for flexibility
- Vercel preview deployments still point at the prod Supabase project; local can't serve them

## Production project setup

Dashboard config for the production Supabase project (not needed locally — `config.toml` covers it):

- **Auth → Settings** → disable "Enable Sign Ups" (invite-only)
- **Auth → URL Configuration** → Site URL, plus Redirect URLs:
  - `https://www.slingers.app/**`
  - `http://localhost:8081/**`
  - `https://*.vercel.app/**` (covers Vercel preview deployments)
- **Auth → Users** → invite users manually (Invite user)
