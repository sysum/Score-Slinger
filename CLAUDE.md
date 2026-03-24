# Score Slinger — Claude Context

## What This App Does

Score Slinger is a mobile + web app for logging scores from theme park ride games (primarily Marvel's Web Slingers: A Spider-Man Adventure at Disney California Adventure). Users photograph a game scoreboard, AI parses the scores automatically, and results are saved to a history.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile/Web frontend | Expo (React Native) with expo-router |
| Backend API | Hono on Vercel (serverless functions) |
| Database | Supabase PostgreSQL via Drizzle ORM |
| Image storage | Supabase Storage (private bucket: `scores`) |
| AI parsing | OpenAI `gpt-4o-mini` vision |
| Auth | Not yet implemented — planned with Supabase Auth |

---

## Project Structure

```
/
├── api/
│   └── index.ts          # Vercel serverless handler — re-exports Hono app
├── app/
│   └── index.tsx         # Main Expo screen (~2300 lines — all UI + client logic)
├── assets/               # Images, fonts
├── components/           # Shared React components (ErrorBoundary, KeyboardAwareScrollView)
├── constants/
│   └── colors.ts         # Theme color definitions
├── contexts/
│   └── ThemeContext.tsx  # App theme (dark/light) context
├── lib/
│   ├── query-client.ts   # TanStack Query setup + apiRequest helper + getApiUrl()
│   └── supabase.ts       # Client-side Supabase instance (anon key, safe for Expo)
├── scripts/
│   └── build.js          # Static Expo Go bundle build script (legacy, not used for Vercel)
├── server/
│   ├── app.ts            # Hono app — all 6 API routes + CORS
│   ├── db.ts             # Drizzle ORM instance
│   ├── index.ts          # Local dev entry point (@hono/node-server, port 5000)
│   ├── supabase.ts       # Server-side Supabase admin client (service role key — never expose)
│   └── templates/
│       └── landing-page.html  # QR code landing page for Expo Go (served locally)
├── shared/
│   └── schema.ts         # Drizzle schema — single source of truth for DB types
├── vercel.json           # Vercel build + routing config
├── drizzle.config.ts     # Drizzle Kit config
└── .env.example          # All required environment variables with descriptions
```

---

## API Routes (server/app.ts)

| Method | Route | Description |
|---|---|---|
| POST | `/api/parse-score` | Receives `{ imagePath }`, fetches image from Supabase Storage using service role, passes to OpenAI vision, returns parsed JSON |
| GET | `/api/scores` | Returns all scores ordered by `createdAt` DESC |
| POST | `/api/scores` | Saves a parsed score (with `imagePath`, not base64) |
| PATCH | `/api/scores/:id/player-names` | Updates custom player name labels |
| GET | `/api/scores/:id/image-url` | Generates a 60-second signed URL for a score's private image |
| DELETE | `/api/scores/:id` | Deletes a score record |

---

## Database Schema (shared/schema.ts)

### `scores` table
- `id` — UUID primary key
- `uploaderName` — display name of the person who uploaded
- `teamScore` — combined team score (integer)
- `achievement` — label above team score (e.g. "BEST THIS HOUR") or null
- `gameName` — detected game name
- `objectiveScores` — JSONB `{ fightGiantBot, rescueSpiderMan, destroyGiantBot }`
- `players` — JSONB array `[{ name, score, color }]` — always 4 players (blue/yellow/red/purple)
- `playerNames` — JSONB `Record<string, string>` — user-edited player labels
- `imagePath` — Supabase Storage path (e.g. `scores/1234567890-abc.jpg`) — **not** a URL
- `playedDate` — ISO timestamp of when the game was played (from EXIF or user input)
- `createdAt` — auto-set timestamp

### `users` table
Defined in schema but not yet used — placeholder for future Supabase Auth integration.

---

## Image Flow

```
Client                   Supabase Storage       Hono API             OpenAI
  │                             │                   │                   │
  │── upload to private ───────▶│                   │                   │
  │   bucket (anon key)         │                   │                   │
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

Images are **never** stored as base64 in the database. `imagePath` is just a string path in the private `scores` bucket. Displaying an image requires calling `GET /api/scores/:id/image-url` to get a short-lived signed URL (60s).

---

## Environment Variables

See `.env.example` for the full list. Key distinction:

- `EXPO_PUBLIC_*` — safe for the client (Expo app), bundled into the app build
- Everything else — server-only, set in Vercel dashboard for production

---

## Local Development

Two terminals required:

```bash
# Terminal 1 — API server (port 5000)
npm run server:dev

# Terminal 2 — Expo dev server
npm run expo:dev
```

The `getApiUrl()` function in `lib/query-client.ts` automatically uses `http://` for localhost and `https://` for all other domains.

---

## Deployment (Vercel)

`vercel.json` is configured to:
1. Run `npx expo export --platform web` as the build command (outputs to `dist/`)
2. Serve `dist/` as static files for the web app
3. Route all `/api/*` requests to `api/index.ts` (the Hono serverless function)

Set all non-`EXPO_PUBLIC_*` environment variables in the Vercel project dashboard. `EXPO_PUBLIC_*` vars must also be set there so they are baked into the static build.

---

## Known Cleanup Items

- `@types/express` is still in devDependencies — can be removed (Express was replaced by Hono)
- `@neondatabase/serverless` is still in dependencies — unused, can be removed
- `scripts/build.js` is the old Replit/Expo Go static build script — can be deleted once Vercel deployment is confirmed working
- `server/templates/landing-page.html` — the QR landing page, only relevant if serving the Expo Go static build outside of Vercel

---

## Auth Architecture (Step 3 — complete)

- All API routes protected by `requireAuth` middleware in `server/app.ts`
- Middleware verifies the Supabase JWT via `supabaseAdmin.auth.getUser(token)`
- Client attaches `Authorization: Bearer <token>` on every request via `lib/query-client.ts`
- Session persisted via AsyncStorage (native) / localStorage (web) — survives app restarts
- Magic link flow: `signInWithOtp` → email → tap link → deep link → `exchangeCodeForSession` → session
- Auth screen is in `components/AuthScreen.tsx` — designed with method switcher for future email/password
- Sign out is in the Settings screen under the Account section
- `scores.userId` (nullable text) stores `auth.users.id` on every new score insert
- `users` table removed — Supabase Auth owns user management

### Supabase dashboard config required for auth
1. Auth → Settings → **Disable "Enable Sign Ups"** (invite-only)
2. Auth → URL Configuration → add redirect URLs:
   - `scoreslinger://**` (native deep link)
   - `https://yourapp.vercel.app/**` (production web)
   - `http://localhost:8081/**` (local web dev)
3. Invite users via Supabase dashboard → Auth → Users → Invite user

---

## Pending Work

- [ ] Tighten Supabase Storage RLS: change anon upload policy to authenticated users only
- [ ] Add `ALLOWED_ORIGINS` to Vercel env vars for production CORS
- [ ] Future: add email/password auth method to `components/AuthScreen.tsx`
- [ ] Future: per-user score filtering (RLS on `scores` table by `user_id`) if needed
