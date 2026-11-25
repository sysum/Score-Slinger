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
| AI parsing | OpenAI `gpt-4.1-mini` vision |
| Auth | Supabase Auth — magic link, PKCE flow, invite-only |
| Analytics | PostHog (`posthog-react-native`) — event tracking, web \+ native |
| Observability | Sentry — server `@sentry/hono` \+ `@sentry/node` (pinned 11.12.0, project `score-slinger-api`, no-op without `SENTRY_DSN`); client `@sentry/react-native` (pinned 8.35.0, project `score-slinger-web`, no-op without `EXPO_PUBLIC_SENTRY_DSN`). Errors, traces, structured logs; all exceptions go to Sentry, PostHog keeps product events. See `docs/SENTRY_PLAN.md` |

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

│   ├── TabBar.tsx        \# Custom tab bar — History | FAB | Profile; action sheet for camera/library

│   └── Toast.tsx         \# Toast view rendered by ToastProvider (Reanimated, above TabBar, FullWindowOverlay on iOS)

├── constants/

│   └── colors.ts         \# Theme color definitions

├── contexts/

│   ├── ThemeContext.tsx  \# App theme (dark/light) context

│   └── ToastContext.tsx  \# App-level toast — ToastProvider (mounted in app/\_layout.tsx) \+ useToast().showToast(message, { type })

├── lib/

│   ├── analytics.ts      \# PostHog wrapper — client options, super props, identifyUser/track/screen/setPersonProperties/reset (no error capture: that's Sentry); null-safe (no-op if EXPO\_PUBLIC\_POSTHOG\_KEY not set). Full event catalog in CONTEXT.md → External Integrations → PostHog.

│   ├── api-url.ts        \# getApiUrl() — dependency-free (re-exported by query-client)

│   ├── monitoring.ts     \# Sentry client wrapper — init (only with EXPO\_PUBLIC\_SENTRY\_DSN), captureException, set/clearMonitoringUser. MUST stay the first import of app/\_layout.tsx

│   ├── query-client.ts   \# TanStack Query setup \+ apiRequest helper (sends X-Request-Id; throws ApiError with .status / .requestId) \+ getApiUrl()

│   ├── use-delete-score.ts \# Shared delete flow for History + Score Detail modals (guard, optimistic cache, 404-as-success, toast)

│   └── supabase.ts       \# Client-side Supabase instance (publishable key in prod / anon demo key locally, PKCE, AsyncStorage)

├── server/

│   ├── app.ts            \# Hono app — all 7 API routes \+ Sentry \+ request-id \+ CORS \+ requireAuth middleware

│   ├── index.ts          \# Local dev entry point (@hono/node-server, port 5055\)

│   ├── instrument.ts     \# Sentry.init — MUST stay the first import of api/index.ts and server/index.ts

│   ├── log.ts            \# Structured logger (`log.info("event", attrs)`) — use instead of console.\* in server code

│   └── supabase.ts       \# Server-side Supabase admin client (secret key in prod / service-role demo key locally — never expose)

├── shared/

│   ├── schema.ts         \# TypeScript types only — Score type shared between client and server

│   └── scrub.ts          \# Redacts JWTs/keys/tokens/codes/data:image from everything sent to Sentry (server \+ client)

├── supabase/

│   ├── config.toml             \# Local Supabase stack config (auth, ports, redirects)

│   ├── migrations/             \# Schema source of truth — scores table, storage bucket \+ policies

│   ├── seed.sql                \# Local seed — test user dev@local.test \+ 2 fake scores

│   └── README.md               \# Local Supabase workflow guide \+ prod project setup

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
| PATCH | `/api/scores/:id/played-date` | Updates the played date — `{ playedDate }`, stored as an ISO string; 400 if unparseable; owner only (403 otherwise, 404 if missing) |
| GET | `/api/scores/:id/image-url` | Generates a 60-second signed URL for a score's private image |
| DELETE | `/api/scores/:id` | Deletes a score record (owner only), then best-effort removes its image from Storage |

---

## Database (Supabase)

No ORM. The schema source of truth is `supabase/migrations/` (`20260101000000_scores_table.sql`, `20260101000001_storage_bucket_and_policies.sql`), which mirror live prod exactly and build the full schema (including the `scores` bucket) on a local Supabase stack. Local dev runs against that stack (Supabase CLI \+ Docker), not prod. To change the schema: `supabase migration new <name>`, test locally with `npm run db:reset`, then apply to prod via the dashboard SQL Editor (or Supabase MCP `apply_migration`) — prod's existing schema predates the migrations folder. The `shared/schema.ts` file contains only the TypeScript `Score` type for use across client and server.

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
- **Local `.env` points at the local Supabase stack** (`SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` = `http://127.0.0.1:54321`; service-role + anon keys from `supabase status -o env` — well-known local demo keys, not secrets). Prod uses a secret key (`sb_secret_…`) server-side and a publishable key (`sb_publishable_…`, in `EXPO_PUBLIC_SUPABASE_ANON_KEY`; name kept for compatibility); the legacy JWT keys are disabled in prod. Prod values live in `.env.prod-reference` (gitignored; never commit). Switching to prod is a deliberate `cp .env.prod-reference .env`. `OPENAI_API_KEY` and the Non-Prod PostHog key are unchanged.

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

SENTRY\_DSN=                \# score-slinger-api DSN — server-only here; set in Vercel (Production \+ Preview), unset locally = Sentry no-op

EXPO\_PUBLIC\_SENTRY\_DSN=    \# score-slinger-web DSN — client-safe, baked into the bundle; set in Vercel (Production \+ Preview), unset locally = Sentry.init never runs

SENTRY\_AUTH\_TOKEN=         \# Vercel build only (Sensitive) — source-map upload in `npm run build:web`; unset = skipped

SENTRY\_ORG= / SENTRY\_PROJECT= \# team-beam / score-slinger-web — Vercel build only

EXPO\_PUBLIC\_POSTHOG\_DEBUG= \# "true" enables PostHog SDK debug logging

\# Set by vercel.json's buildCommand from Vercel system vars (not in .env):

\# EXPO\_PUBLIC\_VERCEL\_ENV, EXPO\_PUBLIC\_COMMIT\_SHA → PostHog environment / commit super props

---

## Local Development

Requires a `.env` at the repo root (copy `.env.example`) and **Docker Desktop running**. Start the local Supabase stack first (cold start ~30s; deliberately not chained into `npm run dev`):

npm run db:start   \# supabase start — also db:stop, db:reset (re-applies migrations \+ seed, wipes local data), db:status

Local endpoints: API `http://127.0.0.1:54321`, Postgres `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio `http://127.0.0.1:54323`, Mailpit (local inbox for magic-link emails) `http://127.0.0.1:54324`.

Sign in as the seeded test user `dev@local.test` — request a magic link, then open it from Mailpit. Prod users don't exist locally; add more via Studio → Authentication → Add user (auto-confirm).

Native caveat: iOS Simulator reaches `127.0.0.1`; Android emulator needs `10.0.2.2:54321`; a physical phone needs the Mac's LAN IP in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_DOMAIN`.

Then run both servers with one command:

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
- `vercel.json` runs `npm run build:web` (`expo export --platform web --source-maps` → Sentry source-map upload if `SENTRY_AUTH_TOKEN` is set → **always** deletes `dist/**/*.map`), serves `dist/`, routes `/api/*` to Hono  
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

### Supabase dashboard config required (production project only)

Local auth is configured in `supabase/config.toml` instead: invite-only (`enable_signup = false`), site_url `http://localhost:8081`, redirects `http://localhost:8081/**` and `scoreslinger://**`.

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
- [ ] Known risk: Vercel preview deployments still point at the **prod** Supabase project (local can't serve them) — options: a cloud non-prod project, or Supabase Branching  
- [ ] Follow-up: test native devices (simulator/emulator/phone) against the local Supabase stack  
- [ ] Follow-up: clean up orphaned images in prod storage (33 objects in `scores` vs 5 rows, from discarded uploads). New deletes/discards now remove their image (`fix/upload-flow-bugs`); a cancel before the auto-save still orphans its upload (no client Storage delete policy)  
- [ ] Follow-up: upgrade Supabase CLI to v3 (currently 2.117.0)
- [ ] Follow-up: Sentry Phase 4 (optional replay) needs a decision (`docs/SENTRY_PLAN.md`)
- [ ] Scheduled on/after 2026-12-02: dependency batch (c) — concurrently 10.0.7, plus `npm update` of node-forge, postcss, source-map-js, browserslist, baseline-browser-mapping, brace-expansion once their newest in-range versions are ≥7 days old (details in `PROJECT_STATE.md`)
- [ ] Future project: Expo SDK 58 upgrade — clears the residual Expo-tooling / expo-router audit findings

**npm audit status:** `npm audit --omit=dev` is **not** clean: 23 findings (1 critical, 8 high, 14 moderate) after the 2026-11-25 deps-security pass (`chore/deps-security`; was 36). What remains is either scheduled (batch (c), incl. the critical `shell-quote`) or accepted risk until the SDK 58 upgrade; see **CONTEXT.md → Dependency security** for the accepted-risk list. Supply-chain rule: only install versions published ≥7 days ago (`npm install --before=<date>` enforces it).

Recently done: dependency security batches (a) + (b) (hono 4.13.18, `@hono/node-server` 2.1.8, unused `zod` / `ws` / `@expo/ngrok` removed, Expo SDK 56 patch alignment to expo 56.0.24). Sentry Phase 2 + 3 (client SDK, PostHog error split, source maps; PR #21), TabBar haptics fix (PR #20), Sentry Phase 1 (server errors, traces, logs; PR #19, verified in prod) and the stale-bundle reload guard (`lib/version-check.ts`, PR #18). Earlier: local Supabase dev workflow (CLI \+ Docker, `npm run db:*`, schema in `supabase/migrations/` mirroring prod, seed user `dev@local.test`, prod env kept in `.env.prod-reference`) — local dev no longer writes to prod. Earlier: dependency refresh to Expo SDK 56 (from 54); removed legacy `scripts/build.js`, `server/templates/landing-page.html`, and orphaned `shared/models/chat.ts`; added `npm run dev`; moved local server port to 5055.

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
