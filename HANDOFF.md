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
| AI | OpenAI `gpt-4o-mini` vision |
| Auth | Supabase magic link, PKCE, invite-only |
| Analytics | PostHog (optional — disabled if `EXPO_PUBLIC_POSTHOG_KEY` not set) |

---

## Local Dev

**One command runs both servers (WSL recommended on Windows):**

\# If node\_modules were installed on Windows and you're in WSL, reinstall first:

rm \-rf node\_modules && npm ci

\# Runs the API server + Expo dev server together (concurrently)

npm run dev

Or two terminals if you want Expo's interactive TUI shortcuts (`r`/`i`/`j`):

\# Terminal 1 — API server (port 5055\)

npm run server:dev

\# Terminal 2 — Expo dev server (port 8081\)

npm run expo:dev

- `http://localhost:5055/` → 404 (expected — only `/api/*` routes exist; port is 5055, not 5000 — AirPlay binds 5000)  
- `http://localhost:8081/` → Expo web app

**`.env` required** — copy `.env.example` and fill in values from Vercel/Supabase dashboards. For `EXPO_PUBLIC_POSTHOG_KEY`, use the **Non-Prod** PostHog project's key locally (and for preview deploys) — only production should point at the prod PostHog project. This keeps dev events out of production analytics while still letting you verify tracking works.

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

## What Was Just Done (as of 2026-07-20)

1. **Analytics event coverage** (PR #4, merged) — comprehensive PostHog tracking of every user action (~40 events), including mobile gestures tagged with `platform`. Full catalog in `CONTEXT.md → External Integrations → PostHog`. Separate **Non-Prod PostHog project** set up for local/preview.  
2. **Dependency refresh** (PR #3, merged) — Expo SDK 54 → 56 (React 19.2, RN 0.85), `@hono/node-server` 1 → 2, `zod` 3 → 4, patch/minor sweep. All `npm audit` highs cleared. Swipe-to-delete migrated `PanResponder` → `react-native-gesture-handler`. Dead files removed.  
3. **Dev-workflow** — `npm run dev` runs both servers via `concurrently`; local server port moved to **5055** (AirPlay binds 5000).

Earlier milestones (still current): the UI redesign (expo-router tab + modal architecture; History / Profile / Upload / Score-detail screens), the `DELETE /api/scores/:id` ownership check, and shareable deep-link score URLs.

---

## Next Up

- [ ] Verify the latest production deploy is live + green on `www.slingers.app` (deps + analytics)  
- [ ] Optional: clear the 3 remaining `tsc` baseline errors + lint warnings  
- [ ] Consider a separate Non-Prod Supabase project (local dev currently writes to prod DB)  
- [ ] Future: profile photo support (avatar circle already in place, shows initials — swap for `<Image>`)  
- [ ] Future: email/password as second auth method in `components/AuthScreen.tsx`  
- [ ] Future: per-user score filtering via RLS on `scores` table  
- [ ] Future: observability / error tracking (e.g. Sentry)

---

## Known Gotchas

- **WSL \+ Windows `node_modules`**: If you get an esbuild platform error, run `rm -rf node_modules && npm ci` from WSL  
- **`EXPO_PUBLIC_DOMAIN` with `https://` prefix** → breaks `getApiUrl()` (produces `https://https://...`)  
- **CORS on preview deploys**: Preview URL must be in `ALLOWED_ORIGINS` or requests fail  
- **Supabase redirect URLs**: Preview URL must be whitelisted or magic link redirects to prod  
- **Local server port is 5055** (not 5000 — macOS AirPlay Receiver binds 5000, causing `EADDRINUSE`). `localhost:5055` root returns 404 — expected, only `/api/*` is handled  
- **PostHog fires locally** if `EXPO_PUBLIC_POSTHOG_KEY` is set in `.env` — use the **Non-Prod** PostHog project's key locally so dev events don't land in production analytics  
- **`EXPO_PUBLIC_*` changes** require a full Vercel redeploy with no build cache

