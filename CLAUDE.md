# Score Slinger — Claude Context

## What This App Does

Score Slinger is a mobile + web app for logging scores from theme park ride games (primarily Marvel's Web Slingers: A Spider-Man Adventure at Disney California Adventure). Users photograph a game scoreboard, AI parses the scores automatically, and results are saved to a history.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile/Web frontend | Expo (React Native) with expo-router |
| Backend API | Hono on Vercel (serverless functions) |
| Database | Supabase PostgreSQL — queried directly via `@supabase/supabase-js` (no ORM) |
| Image storage | Supabase Storage (private bucket: `scores`) |
| AI parsing | OpenAI `gpt-4o-mini` vision |
| Auth | Supabase Auth — magic link, invite-only |

---

## Project Structure

```
/
├── api/
│   └── index.ts          # Vercel serverless handler — re-exports Hono app
├── app/
│   └── index.tsx         # Main Expo screen — all UI + client logic
├── assets/               # Images, fonts
├── components/
│   └── AuthScreen.tsx    # Magic link sign-in screen (extensible for future methods)
├── constants/
│   └── colors.ts         # Theme color definitions
├── contexts/
│   └── ThemeContext.tsx  # App theme (dark/light) context
├── lib/
│   ├── query-client.ts   # TanStack Query setup + apiRequest helper + getApiUrl()
│   └── supabase.ts       # Client-side Supabase instance (anon key, safe for Expo)
├── scripts/
│   └── build.js          # Legacy Expo Go static build script — unused, can be deleted
├── server/
│   ├── app.ts            # Hono app — all 6 API routes + CORS + requireAuth middleware
│   ├── index.ts          # Local dev entry point (@hono/node-server, port 5000)
│   ├── supabase.ts       # Server-side Supabase admin client (service role key — never expose)
│   └── templates/
│       └── landing-page.html  # Legacy QR landing page — unused, can be deleted
├── shared/
│   └── schema.ts         # TypeScript types only — Score type shared between client and server
├── vercel.json           # Vercel build + routing config
└── .env.example          # All required environment variables with descriptions
```

---

## API Routes (server/app.ts)

All routes require `Authorization: Bearer <supabase_jwt>` — protected by `requireAuth` middleware.

| Method | Route | Description |
|---|---|---|
| POST | `/api/parse-score` | Receives `{ imagePath }`, fetches image from Supabase Storage using service role, passes to OpenAI vision, returns parsed JSON |
| GET | `/api/scores` | Returns all scores ordered by `createdAt` DESC |
| POST | `/api/scores` | Saves a parsed score (with `imagePath`, not base64) |
| PATCH | `/api/scores/:id/player-names` | Updates custom player name labels |
| GET | `/api/scores/:id/image-url` | Generates a 60-second signed URL for a score's private image |
| DELETE | `/api/scores/:id` | Deletes a score record |

---

## Database (Supabase)

Schema is managed via the **Supabase dashboard** — no ORM or migration CLI. The `shared/schema.ts` file contains only the TypeScript `Score` type for use across client and server.

### `scores` table
- `id` — UUID primary key
- `user_id` — nullable text, references `auth.users(id)` — set on every insert
- `uploader_name` — display name of the person who uploaded
- `team_score` — combined team score (integer)
- `achievement` — label above team score (e.g. "BEST THIS HOUR") or null
- `game_name` — detected game name
- `objective_scores` — JSONB `{ fightGiantBot, rescueSpiderMan, destroyGiantBot }`
- `players` — JSONB array `[{ name, score, color }]` — always 4 players (blue/yellow/red/purple)
- `player_names` — JSONB `Record<string, string>` — user-edited player labels
- `image_path` — Supabase Storage path (e.g. `scores/1234567890-abc.jpg`) — **not** a URL
- `played_date` — ISO timestamp of when the game was played (from EXIF or user input)
- `created_at` — auto-set timestamp

> Note: column names in the DB are snake_case. The `toScore()` function in `server/app.ts` maps them to the camelCase `Score` type before returning to the client.

---

## Image Flow

```
Client                   Supabase Storage       Hono API             OpenAI
  │                             │                   │                   │
  │── upload to private ───────▶│                   │                   │
  │   bucket (auth key)         │                   │                   │
  │◀── returns storage path ────│                   │                   │
  │                             │                   │                   │
  │── POST /api/parse-score ───────────────────────▶│                   │
  │   { imagePath }             │                   │                   │
  │                             │◀── download ───────│ (service role)    │
  │                             │─── image buffer ──▶│                   │
  │                             │                   │── base64 (transient)▶│
  │                             │                   │◀── parsed JSON ────│
  │◀──────────────────────────────── result ─────────│                   │
  │                             │                   │                   │
  │── POST /api/scores ────────────────────────────▶│                   │
  │   { imagePath, scores... }  │                   │                   │
```

Images are **never** stored as base64 in the database. `imagePath` is a string path in the private `scores` bucket. Displaying an image requires calling `GET /api/scores/:id/image-url` to get a short-lived signed URL (60s).

---

## Environment Variables

See `.env.example` for the full list. Key distinction:

- `EXPO_PUBLIC_*` — safe for the client (Expo app), bundled into the app build
- Everything else — server-only, set in Vercel dashboard for production

### Required variables
```bash
# Server-only
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Client-safe (also needed server-side for Vercel build)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_DOMAIN=        # e.g. localhost:5000 (dev) or yourapp.vercel.app (prod)

# Optional
ALLOWED_ORIGINS=           # Comma-separated CORS origins for production
```

---

## Local Development

Two terminals required:

```bash
# Terminal 1 — API server (port 5000)
npm run server:dev

# Terminal 2 — Expo dev server
npm run expo:dev
```

Browsing to `http://localhost:5000/` returns 404 — that's expected. The server only handles `/api/*` routes. Static files are served by the Expo dev server on port 8081.

---

## Deployment (Vercel)

`vercel.json` is configured to:
1. Run `npx expo export --platform web` as the build command (outputs to `dist/`)
2. Serve `dist/` as static files for the web app
3. Route all `/api/*` requests to `api/index.ts` (the Hono serverless function)

Set all non-`EXPO_PUBLIC_*` environment variables in the Vercel project dashboard. `EXPO_PUBLIC_*` vars must also be set there so they are baked into the static build.

---

## Auth Architecture

- All API routes protected by `requireAuth` middleware in `server/app.ts`
- Middleware verifies the Supabase JWT via `supabaseAdmin.auth.getUser(token)`
- Client attaches `Authorization: Bearer <token>` on every request via `lib/query-client.ts`
- Session persisted via AsyncStorage (native) / localStorage (web) — survives app restarts
- Magic link flow: `signInWithOtp` → email → tap link → deep link → `exchangeCodeForSession` → session
- Auth screen is in `components/AuthScreen.tsx` — designed with method switcher for future email/password
- Sign out is in the Settings screen under the Account section
- `scores.user_id` stores `auth.users.id` on every new score insert

### Supabase dashboard config required for auth
1. Auth → Settings → **Disable "Enable Sign Ups"** (invite-only)
2. Auth → URL Configuration → add redirect URLs:
   - `scoreslinger://**` (native deep link)
   - `https://yourapp.vercel.app/**` (production web)
   - `http://localhost:8081/**` (local web dev)
3. Invite users via Supabase dashboard → Auth → Users → Invite user

---

## Pending Work

- [ ] Deploy to Vercel — set env vars in dashboard, verify end-to-end
- [ ] Add `ALLOWED_ORIGINS` env var in Vercel dashboard for production CORS
- [ ] Future: add email/password auth method to `components/AuthScreen.tsx`
- [ ] Future: per-user score filtering (RLS on `scores` table by `user_id`) if needed
- [ ] Cleanup: delete `scripts/build.js` and `server/templates/` once Vercel deployment is confirmed
