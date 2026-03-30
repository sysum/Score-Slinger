# Score Slinger

A mobile and web app for logging scores from theme park ride games. Photograph a scoreboard, and AI automatically extracts the team score, individual player scores, and objectives. Results are saved to a history you can browse and manage.

Built for **Marvel's Web Slingers: A Spider-Man Adventure** at Disney California Adventure, but designed to work with similar scoreboard layouts.

---

## Features

- Magic link sign-in — invite-only access
- Photograph or upload a scoreboard image (JPEG, PNG; HEIC supported on native)
- AI parses team score, 4 player scores (by color), and 3 objective scores
- EXIF date extraction — automatically uses the photo's taken date
- Duplicate detection — warns if a score from the same timeframe already exists
- Score history with sorting and browsing
- Custom player name labels
- Profile menu — change name, access settings, sign out
- Display name synced to Supabase user metadata (persists across devices)
- Dark/light/system theme

---

## Tech Stack

- **Frontend:** Expo (React Native) — iOS, Android, and Web from one codebase
- **Backend:** Hono running as a Vercel serverless function
- **Database:** Supabase PostgreSQL via `@supabase/supabase-js` (no ORM)
- **Image storage:** Supabase Storage (private bucket)
- **Auth:** Supabase Auth — magic link, PKCE flow, invite-only
- **AI:** OpenAI `gpt-4o-mini` vision API

---

## Prerequisites

- Node.js 20+
- An [OpenAI account](https://platform.openai.com) with an API key
- A [Supabase](https://supabase.com) project
- (For mobile) Expo Go app on your device, or iOS/Android simulator

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd score-slinger
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `EXPO_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / public key |
| `EXPO_PUBLIC_DOMAIN` | `localhost:5000` for local dev — no `https://` prefix |

### 3. Set up Supabase

See [`supabase/README.md`](supabase/README.md) for full step-by-step instructions including SQL files for the table, storage policies, and auth configuration.

---

## Running Locally

Two terminals are required:

```bash
# Terminal 1 — API server (http://localhost:5000)
npm run server:dev

# Terminal 2 — Expo dev server
npm run expo:dev
```

Then:
- **Web:** open [http://localhost:8081](http://localhost:8081) in a browser
- **Mobile:** scan the QR code with Expo Go

> Browsing to `http://localhost:5000/` returns 404 — that's expected. The server only handles `/api/*` routes.

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add all environment variables in the Vercel project settings
4. Set `EXPO_PUBLIC_DOMAIN` to your production domain **without** `https://` and without a trailing slash (e.g. `www.slingers.app`). It must match the domain users browse to — same origin avoids CORS entirely.
5. Set `ALLOWED_ORIGINS` to comma-separated allowed origins if needed (e.g. `https://www.slingers.app,https://slingers.app`)
6. Deploy — **do not use build cache** when changing `EXPO_PUBLIC_*` vars

> `EXPO_PUBLIC_*` vars are baked into the static build at build time. Any change requires a fresh redeploy (no cache).

---

## Project Structure

```
├── api/index.ts          # Vercel serverless entry point
├── app/index.tsx         # Main screen (UI + client logic)
├── components/
│   └── AuthScreen.tsx    # Magic link sign-in screen
├── constants/colors.ts   # Theme colors
├── contexts/             # React context (theme)
├── lib/
│   ├── query-client.ts   # API request helpers + TanStack Query setup
│   └── supabase.ts       # Client-side Supabase instance (PKCE, AsyncStorage)
├── server/
│   ├── app.ts            # Hono app with all API routes
│   ├── index.ts          # Local dev server
│   └── supabase.ts       # Server-side Supabase admin client
├── shared/schema.ts      # TypeScript Score type (shared client/server)
├── vercel.json           # Vercel config
└── .env.example          # Environment variable reference
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run server:dev` | Start the Hono API server locally (port 5000) |
| `npm run expo:dev` | Start the Expo dev server |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
