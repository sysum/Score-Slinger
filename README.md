# Score Slinger

A mobile and web app for logging scores from theme park ride games. Photograph a scoreboard, and AI automatically extracts the team score, individual player scores, and objectives. Results are saved to a history you can browse and manage.

Built for **Marvel's Web Slingers: A Spider-Man Adventure** at Disney California Adventure, but designed to work with similar scoreboard layouts.

---

## Features

- Photograph or upload a scoreboard image
- AI parses team score, 4 player scores (by color), and 3 objective scores
- EXIF date extraction — automatically uses the photo's taken date
- Duplicate detection — warns if a score from the same timeframe already exists
- Score history with sorting and browsing
- Custom player name labels
- Dark/light theme

---

## Tech Stack

- **Frontend:** Expo (React Native) — iOS, Android, and Web from one codebase
- **Backend:** Hono running as a Vercel serverless function
- **Database:** Supabase PostgreSQL via Drizzle ORM
- **Image storage:** Supabase Storage (private bucket)
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
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (Transaction mode) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `EXPO_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` / public key |
| `EXPO_PUBLIC_DOMAIN` | `localhost:5000` for local dev |

### 3. Set up Supabase Storage

1. In your Supabase project, go to **Storage**
2. Create a new bucket named `scores` — leave **Public bucket** unchecked
3. Add a Storage policy to allow uploads:
   - Policy name: `Allow anon uploads`
   - Operation: INSERT
   - Target roles: `anon`
   - Definition: `true`

> Once authentication is added, this policy should be tightened to only allow authenticated users to upload.

### 4. Push the database schema

```bash
npm run db:push
```

This creates the `scores` and `users` tables in your Supabase database.

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

---

## Deploying to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com)
3. Add all environment variables in the Vercel project settings (including all `EXPO_PUBLIC_*` vars — they need to be present at build time)
4. Set `EXPO_PUBLIC_DOMAIN` to your Vercel deployment URL (e.g. `yourapp.vercel.app`)
5. Set `ALLOWED_ORIGINS` to `https://yourapp.vercel.app` for CORS
6. Deploy

Vercel automatically builds the Expo web export and routes `/api/*` to the Hono serverless function.

---

## Project Structure

```
├── api/index.ts          # Vercel serverless entry point
├── app/index.tsx         # Main screen (UI + client logic)
├── components/           # Shared components
├── constants/colors.ts   # Theme colors
├── contexts/             # React context (theme)
├── lib/
│   ├── query-client.ts   # API request helpers + TanStack Query setup
│   └── supabase.ts       # Client-side Supabase instance
├── server/
│   ├── app.ts            # Hono app with all API routes
│   ├── db.ts             # Drizzle ORM instance
│   ├── index.ts          # Local dev server
│   └── supabase.ts       # Server-side Supabase admin client
├── shared/schema.ts      # Database schema (Drizzle + Zod types)
├── vercel.json           # Vercel config
└── .env.example          # Environment variable reference
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run server:dev` | Start the Hono API server locally (port 5000) |
| `npm run expo:dev` | Start the Expo dev server |
| `npm run db:push` | Apply schema changes to the database |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
