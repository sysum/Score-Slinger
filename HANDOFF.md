# Score Slinger — Session Handoff

This file gets a new Claude session (or a new laptop) up to speed quickly. For full context read `CONTEXT.md` and `PROJECT_STATE.md` (same folder — repo root).

---

## What This App Is

Score Slinger is a mobile \+ web app for logging scores from Marvel's Web Slingers at Disney California Adventure. Users photograph a game scoreboard → AI parses the scores → saved to a shared history.

- **Production:** [https://www.slingers.app](https://www.slingers.app)  
- **Repo:** GitHub (main branch \= production)  
- **Invite-only** — users must be invited via Supabase Auth dashboard

---

## Tech Stack (quick ref)

| Layer | Tech |
| :---- | :---- |
| Frontend | Expo (React Native) \+ expo-router, TanStack Query |
| Backend | Hono on Vercel serverless (`/api/*`) |
| Database | Supabase PostgreSQL (no ORM — raw `@supabase/supabase-js`) |
| Image storage | Supabase Storage, private bucket `scores` |
| AI | OpenAI `gpt-4.1-mini` vision |
| Auth | Supabase magic link, PKCE, invite-only |
| Analytics | PostHog (optional — disabled if `EXPO_PUBLIC_POSTHOG_KEY` not set) |

---

## Local Dev

**One command runs both servers (WSL recommended on Windows):**

\# If node\_modules were installed on Windows and you're in WSL, reinstall first:

rm \-rf node\_modules && npm ci

\# Start the local Supabase stack first (Docker Desktop must be running; ~30s cold start)

npm run db:start   \# also: db:stop, db:status, db:reset (wipes local data, re-applies migrations \+ seed)

\# Runs the API server + Expo dev server together (concurrently)

npm run dev

Or two terminals if you want Expo's interactive TUI shortcuts (`r`/`i`/`j`):

\# Terminal 1 — API server (port 5055\)

npm run server:dev

\# Terminal 2 — Expo dev server (port 8081\)

npm run expo:dev

- `http://localhost:5055/` → 404 (expected — only `/api/*` routes exist; port is 5055, not 5000 — AirPlay binds 5000)  
- `http://localhost:8081/` → Expo web app  
- Local Supabase: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, Mailpit `http://127.0.0.1:54324`  
- Sign in as **`dev@local.test`** (seeded) — request a magic link, open it from Mailpit

**`.env` required** — copy `.env.example`. The Supabase values point at the **local stack** (`http://127.0.0.1:54321`; service role + anon keys from `supabase status -o env` — well-known local demo keys). Prod values are kept in `.env.prod-reference` (gitignored); switching to prod is a deliberate `cp .env.prod-reference .env`. `OPENAI_API_KEY` comes from the OpenAI dashboard. For `EXPO_PUBLIC_POSTHOG_KEY`, use the **Non-Prod** PostHog project's key locally (and for preview deploys) — only production should point at the prod PostHog project. This keeps dev events out of production analytics while still letting you verify tracking works.

---

## Key Files

app/\_layout.tsx          AuthGate, font loading, Stack \+ modal declarations

app/(tabs)/index.tsx     History screen — score list, sort, swipe-delete

app/(tabs)/profile.tsx   Profile tab — display name, theme, date format, sign out

app/upload.tsx           Upload modal — camera/library → AI parse → auto-save → result

app/score/\[id\].tsx       Score detail modal — image, scores, player name editing, delete

components/TabBar.tsx    Custom tab bar — History | FAB | Profile

components/AuthScreen.tsx Magic link sign-in

server/app.ts            All 6 API routes \+ CORS \+ requireAuth middleware

lib/analytics.ts         PostHog wrapper (no-op if key not set)

lib/query-client.ts      TanStack Query setup \+ apiRequest helper \+ getApiUrl()

lib/supabase.ts          Client Supabase instance (PKCE, AsyncStorage)

constants/colors.ts      Design tokens — dark backgrounds, teal accent \#00E5CC

---

## Navigation Architecture

Stack (app/\_layout.tsx)

├── (tabs)                    ← default, always authenticated

│   ├── index   (History)

│   └── profile (Profile)

├── upload      (modal, slide from bottom)

└── score/\[id\]  (modal, slide from bottom)

- FAB in tab bar → action sheet (camera/library) → `router.push("/upload", { uri, photoDate, fileName })`  
- Score card tap → `router.push("/score/${id}")`  
- Auth gate wraps the entire Stack in `_layout.tsx`

---

## API Routes

All require `Authorization: Bearer <supabase_jwt>`.

| Method | Route | Description |
| :---- | :---- | :---- |
| POST | `/api/parse-score` | `{ imagePath }` → OpenAI vision → parsed JSON |
| GET | `/api/scores` | All scores DESC |
| POST | `/api/scores` | Save parsed score |
| PATCH | `/api/scores/:id/player-names` | Update player name labels (any authed user — intentional) |
| GET | `/api/scores/:id/image-url` | 60s signed URL for private image |
| DELETE | `/api/scores/:id` | Delete score (owner only — checks `user_id`) |

---

## Supabase Dashboard Config

1. **Auth → Settings** → Disable "Enable Sign Ups" (invite-only)  
2. **Auth → URL Configuration → Redirect URLs:**  
   - `https://www.slingers.app/**`  
   - `http://localhost:8081/**`  
   - `https://*.vercel.app/**` ← covers all preview deployments  
3. **Invite users** via Auth → Users → Invite user

---

## Vercel / Deployment Notes

- Merging to `main` triggers an automatic production deploy  
- `EXPO_PUBLIC_*` vars are baked into the static build — changing them requires a redeploy with **no build cache**  
- `EXPO_PUBLIC_DOMAIN` must be the bare hostname with no `https://` prefix (e.g. `www.slingers.app`)  
- `ALLOWED_ORIGINS` \= `https://www.slingers.app,https://slingers.app`  
- For preview branch testing, add the preview URL to `ALLOWED_ORIGINS` in Vercel environment variables for that deployment, then redeploy

---

## What Was Just Done (as of 2026-11-24)

0. **Local Supabase dev workflow** (branch `feat/local-supabase`, 2026-11-24) — local dev now uses a local Supabase stack (CLI 2.117.0 + Docker) instead of prod, so local testing no longer writes real prod data. Scripts `npm run db:start/stop/reset/status`; schema in `supabase/migrations/` (mirrors prod; fixed drift in the old `01_`/`02_` SQL files, which were removed); seed user `dev@local.test` + 2 fake scores; prod env in `.env.prod-reference`. Chose local over a cloud non-prod project because Pro-plan projects each bill compute (~$10/mo). See `supabase/README.md`.  
1. **App logo** (PR #7, merged) — new logo wired into app icon, favicon, splash, and Android adaptive icon; regenerated full-bleed (light artboard bg → navy `#01051D`) so the OS mask renders cleanly. Master source at `assets/images/score-slinger.png`. Baked at build time — verify on a native/EAS build.  
2. **tsc + lint cleanup** (PR #6, merged) — 0 tsc errors / 0 lint warnings (a first). Also fixed a real native bug: `expo-file-system`'s `readAsStringAsync`/`EncodingType` moved to `/legacy` in SDK 56 — the native upload path now imports from there (web unaffected; verify on device).  
3. **Analytics event coverage** (PR #4, merged) — comprehensive PostHog tracking of every user action (~40 events), mobile gestures tagged with `platform`. Catalog in `CONTEXT.md → External Integrations → PostHog`. Separate **Non-Prod PostHog project** for local/preview.  
4. **Dependency refresh** (PR #3, merged) — Expo SDK 54 → 56 (React 19.2, RN 0.85), `@hono/node-server` 1 → 2, `zod` 3 → 4; all `npm audit` highs cleared. `npm run dev` runs both servers; local server port **5055** (AirPlay binds 5000).

Earlier milestones (still current): the UI redesign (expo-router tab + modal architecture; History / Profile / Upload / Score-detail screens), the `DELETE /api/scores/:id` ownership check, and shareable deep-link score URLs.

---

## Next Up

- [ ] Native build verification — app icons/splash (#7) + native-upload fix (#6), both baked at build time  
- [ ] Vercel previews still point at the prod Supabase project (options: cloud non-prod project, Supabase Branching)  
- [ ] Device testing against local Supabase (Android emulator `10.0.2.2:54321`; physical phone needs Mac LAN IP)  
- [ ] Clean up orphaned storage objects in prod (33 objects in `scores` vs 5 rows)  
- [ ] Upgrade Supabase CLI to v3 (currently 2.117.0)  
- [ ] Observability / error tracking (e.g. Sentry)  
- [ ] Deferred dep majors: ESLint 9 → 10, TypeScript 5 → 6 (await tooling support)  
- [ ] Future: profile photo support (avatar circle already in place, shows initials — swap for `<Image>`)  
- [ ] Future: email/password as second auth method in `components/AuthScreen.tsx`  
- [ ] Future: per-user score filtering via RLS on `scores` table

---

## Known Gotchas

- **WSL \+ Windows `node_modules`**: If you get an esbuild platform error, run `rm -rf node_modules && npm ci` from WSL  
- **`EXPO_PUBLIC_DOMAIN` with `https://` prefix** → breaks `getApiUrl()` (produces `https://https://...`)  
- **CORS on preview deploys**: Preview URL must be in `ALLOWED_ORIGINS` or requests fail  
- **Supabase redirect URLs**: Preview URL must be whitelisted or magic link redirects to prod  
- **Local server port is 5055** (not 5000 — macOS AirPlay Receiver binds 5000, causing `EADDRINUSE`). `localhost:5055` root returns 404 — expected, only `/api/*` is handled  
- **PostHog fires locally** if `EXPO_PUBLIC_POSTHOG_KEY` is set in `.env` — use the **Non-Prod** PostHog project's key locally so dev events don't land in production analytics  
- **`EXPO_PUBLIC_*` changes** require a full Vercel redeploy with no build cache  
- **Docker Desktop must be running** for `npm run db:start`; the stack is not started by `npm run dev`  
- **`npm run db:reset` wipes local data** (re-applies migrations + seed) — local only, never `--linked`  
- **Vercel previews still hit the prod Supabase project** — local can't serve them  
- **Prod-only users don't exist locally** — use `dev@local.test` or add one in Studio → Authentication → Add user

