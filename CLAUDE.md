# Score Slinger — Claude Context

**Start every session by reading `CONTEXT.md` and `PROJECT_STATE.md` in this folder.**

---

## What This App Does

Score Slinger is a mobile \+ web app for logging scores from theme park ride games (primarily Marvel's Web Slingers: A Spider-Man Adventure at Disney California Adventure). Users photograph a game scoreboard, AI parses the scores automatically, and results are saved to a history.

---

## Tech Stack

| Layer | Technology |
| :---- | :---- |
| Mobile/Web frontend | Expo (React Native) with expo-router |
| Backend API | Hono on Vercel (serverless functions) |
| Database | Supabase PostgreSQL — queried directly via `@supabase/supabase-js` (no ORM) |
| Image storage | Supabase Storage (private bucket: `scores`) |
| AI parsing | OpenAI `gpt-4o-mini` vision |
| Auth | Supabase Auth — magic link, PKCE flow, invite-only |
| Analytics | PostHog (`posthog-react-native`) — event tracking, web \+ native |

---

## Project Structure

/

├── CLAUDE.md             \# This file — start-here context (repo root)

├── CONTEXT.md            \# Full onboarding doc for new Claude instances

├── PROJECT\_STATE.md      \# Current work in progress, decisions, next steps

├── HANDOFF.md            \# Quick session/laptop handoff summary

├── api/

│   └── index.ts          \# Vercel serverless handler — re-exports Hono app

├── app/

│   ├── \_layout.tsx       \# Root layout — AuthGate, font loading, Stack (tabs \+ modals)

│   ├── (tabs)/

│   │   ├── \_layout.tsx   \# Tab group — uses custom TabBar component

│   │   ├── index.tsx     \# History tab (default) — score list, sort, delete

│   │   └── profile.tsx   \# Profile tab — display name, theme, date format, sign out

│   ├── upload.tsx        \# Modal — image URI params → upload → parse → result → discard

│   └── score/

│       └── \[id\].tsx      \# Modal — score detail, image, player names, delete

├── assets/               \# Images, fonts

├── components/

│   ├── AuthScreen.tsx    \# Magic link sign-in screen (extensible for future methods)

│   └── TabBar.tsx        \# Custom tab bar — History | FAB | Profile; action sheet for camera/library

├── constants/

│   └── colors.ts         \# Theme color definitions

├── contexts/

│   └── ThemeContext.tsx  \# App theme (dark/light) context

├── lib/

│   ├── analytics.ts      \# PostHog wrapper — identify/track/screen/reset; null-safe (no-op if EXPO\_PUBLIC\_POSTHOG\_KEY not set)

│   ├── query-client.ts   \# TanStack Query setup \+ apiRequest helper \+ getApiUrl()

│   └── supabase.ts       \# Client-side Supabase instance (anon key, PKCE, AsyncStorage)

├── server/

│   ├── app.ts            \# Hono app — all 6 API routes \+ CORS \+ requireAuth middleware

│   ├── index.ts          \# Local dev entry point (@hono/node-server, port 5055\)

│   └── supabase.ts       \# Server-side Supabase admin client (service role key — never expose)

├── shared/

│   └── schema.ts         \# TypeScript types only — Score type shared between client and server

├── supabase/

│   ├── 01\_scores\_table.sql     \# Creates scores table \+ enables RLS

│   ├── 02\_storage\_policies.sql \# Storage bucket RLS policies

│   └── README.md               \# Step-by-step Supabase setup instructions

├── vercel.json           \# Vercel build \+ routing config

└── .env.example          \# All required environment variables with descriptions

---

## API Routes (server/app.ts)

All routes require `Authorization: Bearer <supabase_jwt>` — protected by `requireAuth` middleware.

| Method | Route | Description |
| :---- | :---- | :---- |
| POST | `/api/parse-score` | Receives `{ imagePath }`, fetches image from Supabase Storage using service role, passes to OpenAI vision, returns parsed JSON |
| GET | `/api/scores` | Returns all scores ordered by `createdAt` DESC |
| POST | `/api/scores` | Saves a parsed score (with `imagePath`, not base64) |
| PATCH | `/api/scores/:id/player-names` | Updates custom player name labels |
| GET | `/api/scores/:id/image-url` | Generates a 60-second signed URL for a score's private image |
| DELETE | `/api/scores/:id` | Deletes a score record |

---

## Database (Supabase)

Schema is managed via the **Supabase dashboard** — no ORM or migration CLI. SQL setup files are in `supabase/`. The `shared/schema.ts` file contains only the TypeScript `Score` type for use across client and server.

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

Column names in the DB are snake\_case. The `toScore()` function in `server/app.ts` maps them to the camelCase `Score` type before returning to the client.

---

## Image Flow

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

Images are **never** stored as base64 in the database. `imagePath` is a string path in the private `scores` bucket. Displaying an image requires calling `GET /api/scores/:id/image-url` to get a short-lived signed URL (60s).

---

## Environment Variables

See `.env.example` for the full list.

- `EXPO_PUBLIC_*` — safe for the client (Expo app), bundled into the app build  
- Everything else — server-only, set in Vercel dashboard for production

### Required variables

\# Server-only

OPENAI\_API\_KEY=

SUPABASE\_URL=

SUPABASE\_SERVICE\_ROLE\_KEY=

\# Client-safe (also needed server-side for Vercel build)

EXPO\_PUBLIC\_SUPABASE\_URL=

EXPO\_PUBLIC\_SUPABASE\_ANON\_KEY=

EXPO\_PUBLIC\_DOMAIN=        \# bare hostname only — no https://, no trailing slash

                           \# e.g. localhost:5055 (dev) or www.slingers.app (prod)

\# Optional

ALLOWED\_ORIGINS=           \# Comma-separated CORS origins for production

EXPO\_PUBLIC\_POSTHOG\_KEY=   \# PostHog project API key — analytics disabled if not set

EXPO\_PUBLIC\_POSTHOG\_HOST=  \# PostHog ingest host (default: https://us.i.posthog.com)

---

## Local Development

Requires a `.env` at the repo root (copy `.env.example`). Then run both servers with one command:

npm run dev   \# runs server:dev + expo:dev together via concurrently

Or run them in two terminals (needed if you want Expo's interactive TUI shortcuts — `r` reload, `i` iOS, `j` debugger):

\# Terminal 1 — API server (port 5055\)

npm run server:dev

\# Terminal 2 — Expo dev server (port 8081\)

npm run expo:dev

Browsing to `http://localhost:5055/` returns 404 — that's expected. The server only handles `/api/*` routes. Static files are served by the Expo dev server on port 8081\.

The local server port is **5055** (not 5000 — macOS AirPlay Receiver binds 5000, causing `EADDRINUSE`).

---

## Deployment (Vercel)

- Production URL: `https://www.slingers.app`  
- `vercel.json` runs `npx expo export --platform web`, serves `dist/`, routes `/api/*` to Hono  
- `EXPO_PUBLIC_*` vars are baked into the static build — changing them requires a fresh redeploy with **no build cache**  
- `EXPO_PUBLIC_DOMAIN` must match the domain users browse to (same-origin avoids CORS entirely)  
- `ALLOWED_ORIGINS` set to `https://www.slingers.app,https://slingers.app`  
- For Vercel preview branches, add the preview URL to `ALLOWED_ORIGINS` in the Vercel dashboard for that deployment, or update the CORS origin function to allow `*.vercel.app`

---

## Auth Architecture

- All API routes protected by `requireAuth` middleware in `server/app.ts`  
- Middleware verifies the Supabase JWT via `supabaseAdmin.auth.getUser(token)`  
- Client attaches `Authorization: Bearer <token>` on every request via `lib/query-client.ts`  
- Session persisted via AsyncStorage (native) / localStorage (web) — survives app restarts  
- Magic link flow: `signInWithOtp` → email → tap link → `exchangeCodeForSession` → session  
- PKCE flow (`flowType: "pkce"` in `lib/supabase.ts`) — magic link uses `code=` param, not `access_token=`  
- `shouldCreateUser: false` on `signInWithOtp` — unknown emails silently rejected, no email sent  
- Auth gate, session management, and display name setup all live in `app/_layout.tsx` (`AuthGate` component)  
- Sign out and settings are in the **Profile tab** (`app/(tabs)/profile.tsx`)  
- Display name saved to AsyncStorage (fast local load) \+ Supabase `user_metadata.display_name` (cross-device sync)  
- Auth screen is in `components/AuthScreen.tsx` — method switcher pattern ready for future email/password  
- `scores.user_id` stores `auth.users.id` on every insert

### Supabase dashboard config required

1. Auth → Settings → **Disable "Enable Sign Ups"** (invite-only)  
2. Auth → URL Configuration → Redirect URLs:  
   - `https://www.slingers.app/**`  
   - `http://localhost:8081/**`  
   - `https://*.vercel.app/**` — covers all Vercel preview deployments  
3. Invite users via Auth → Users → Invite user

---

## Pending Work

- [ ] Future: add email/password auth method to `components/AuthScreen.tsx`  
- [ ] Future: per-user score filtering (RLS on `scores` table by `user_id`) if needed  
- [ ] Future: profile photo support (avatar circle in Profile tab is ready — currently shows initials)

Recently done: dependency refresh to Expo SDK 56 (from 54), all `npm audit` highs cleared; removed legacy `scripts/build.js`, `server/templates/landing-page.html`, and orphaned `shared/models/chat.ts`; added `npm run dev`; moved local server port to 5055.

---

## Session Management

At the start of every session:

- Read `CONTEXT.md` and `PROJECT_STATE.md` before doing anything else

After completing any significant piece of work (a feature, a fix, a decision, a discovery):

- Update `PROJECT_STATE.md` to reflect what changed, what was decided, and why  
- If the change affects architecture, stack, or conventions, update `CONTEXT.md` as well

Do this without being asked.

## Context File Maintenance

After completing any significant work — a feature, a fix, a decision, a discovery — invoke the update-context skill to update PROJECT\_STATE.md, CONTEXT.md, and this file.

Significant work includes:

- Completing or partially completing a feature  
- Discovering a bug or unexpected behaviour  
- Making an architectural or technical decision  
- Adding a dependency or integration  
- Changing a convention or rule

Do not update files after minor back-and-forth or clarifying questions.  
