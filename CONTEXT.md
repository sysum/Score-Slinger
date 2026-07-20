# Score Slinger — Claude Context

For current work-in-progress, open decisions, and next steps, read `PROJECT_STATE.md` (same folder — repo root) first.

---

## Project Purpose

Score Slinger is a personal mobile \+ web app for logging scores from theme park ride games — specifically **Marvel's Web Slingers: A Spider-Man Adventure** at Disney California Adventure. Users photograph a physical scoreboard at the end of a ride, the app uses OpenAI vision to parse the score automatically, and results are saved to a searchable history.

This is a small, invite-only app for a group of friends/family. There is no public sign-up. All users are manually invited via the Supabase dashboard.

---

## Tech Stack

| Layer | Technology | Notes |
| :---- | :---- | :---- |
| Frontend | Expo (React Native) \~56 \+ expo-router \~56 | iOS, Android, and Web from one codebase; React 19.2, RN 0.85 |
| Backend | Hono ^4 on Vercel serverless (`@hono/node-server` ^2 locally) | Lightweight, TypeScript-native, no Express |
| Database | Supabase PostgreSQL | Queried directly via `@supabase/supabase-js` — **no ORM** |
| Image storage | Supabase Storage | Private bucket named `scores` |
| Auth | Supabase Auth | Magic link only, PKCE flow, invite-only |
| AI | OpenAI `gpt-4o-mini` vision | Parses scoreboard images |
| Data fetching | TanStack Query ^5 | Client-side, infinite stale time, no auto-refetch |
| Analytics | PostHog (`posthog-react-native`) | Event tracking via `lib/analytics.ts` wrapper; no-op if key not set |
| State | React `useState` / `useRef` | No global state library |
| Styling | React Native `StyleSheet` \+ theme context | Dark/light/system modes |

Key non-obvious dependencies:

- `exif-parser` — extracts photo taken date from image EXIF data on the server  
- `expo-file-system` (required in `app/upload.tsx`) — reads image bytes for upload on native  
- `hono/vercel` — adapter that wraps the Hono app as a Vercel serverless handler (`api/index.ts`)  
- `patch-package` — runs via `postinstall`; check `patches/` if build issues arise

---

## Architecture

### Request flow

Browser/App                Supabase Storage     Hono API (Vercel)      OpenAI

     │                           │                     │                  │

     │── 1\. Upload image ────────▶│                     │                  │

     │◀── storage path ───────────│                     │                  │

     │                           │                     │                  │

     │── 2\. POST /api/parse-score ────────────────────▶│                  │

     │       { imagePath }       │                     │── base64 ────────▶│

     │                           │◀── download ─────────│ (service role)   │

     │                           │                     │◀── parsed JSON ───│

     │◀──────────────────────────────── result ─────────│                  │

     │                           │                     │                  │

     │── 3\. POST /api/scores ─────────────────────────▶│ (saves to DB)    │

Images are **never stored as base64 in the database**. `imagePath` is a string path in the private `scores` bucket. Displaying an image always requires a signed URL from `GET /api/scores/:id/image-url` (60s expiry).

### Navigation architecture

expo-router tab \+ modal stack pattern:

app/\_layout.tsx          Root layout — auth gate (AuthGate component), font loading,

                         Stack with (tabs) \+ modal screens (upload, score/\[id\])

app/(tabs)/\_layout.tsx   Tab group — custom TabBar with centered FAB

app/(tabs)/index.tsx     History tab (default) — score list, sort, swipe-to-delete

app/(tabs)/profile.tsx   Profile tab — display name, theme, date format, sort, sign out

app/upload.tsx           Modal — receives image URI as route param, handles full

                         upload → AI parse → auto-save → result display → discard

app/score/\[id\].tsx       Modal — score detail: image, team score, objectives, players,

                         player name editing, delete

Navigation flow:

1. FAB tap → camera action sheet → `router.push("/upload", { uri, photoDate, fileName })`  
2. History card tap → `router.push("/score/[id]")`  
3. Both upload and score/\[id\] are presented as `presentation: "modal"` Stack screens

### Auth flow (in `app/_layout.tsx`)

`AuthGate` component wraps the Stack navigator:

1. `session === undefined` → loading spinner  
2. `session === null` → `<AuthScreen />` (magic link)  
3. `displayName` not set → `<DisplayNameSetup />` inline screen  
4. Otherwise → renders `<Stack>` (tabs \+ modals)

Magic link deep links handled inside `AuthGate` via `Linking.addEventListener`.

### Key files

api/

  index.ts              Vercel serverless entry — wraps Hono app via hono/vercel

app/

  \_layout.tsx           Root layout — AuthGate, font loading, Stack declaration

                        AuthGate handles: session management, deep link handling,

                        display name loading, DisplayNameSetup screen

  (tabs)/

    \_layout.tsx         Tab group — custom TabBar prop

    index.tsx           History screen — score list with redesigned cards

    profile.tsx         Profile/settings tab — all user preferences

  upload.tsx            Upload modal — image URI params → parse → auto-save → result

  score/\[id\].tsx        Score detail modal — fetches from query cache \+ signed image URL

components/

  AuthScreen.tsx        Magic link sign-in UI

  TabBar.tsx            Custom bottom tab bar — History | \[FAB\] | Profile

                        FAB: 64px centered, overlaps tab bar by 28px

                        Action sheet: Take Photo / Choose from Library

                        Handles ImagePicker, EXIF date extraction, router.push to /upload

contexts/

  ThemeContext.tsx      Provides colors \+ isDark \+ setMode to all components

lib/

  supabase.ts           Client Supabase instance (anon key, PKCE, AsyncStorage)

  query-client.ts       getApiUrl(), apiRequest(), getQueryFn(), QueryClient

  analytics.ts          PostHog wrapper — identify/track/screen/reset; null-safe (no-op if key missing)

server/

  app.ts                All 6 API routes \+ CORS middleware \+ requireAuth middleware

                        toScore() maps snake\_case DB rows → camelCase Score type

  index.ts              Local dev entry point (node-server, port 5055\)

  supabase.ts           Admin Supabase client (service role key — server only)

shared/

  schema.ts             TypeScript Score type only — source of truth for shape

supabase/

  01\_scores\_table.sql   Creates scores table \+ enables RLS

  02\_storage\_policies.sql  Storage bucket RLS policies

  README.md             Step-by-step Supabase setup instructions

vercel.json             Build command, output dir, /api/\* routing

---

## External Integrations

### Supabase

- **Project URL:** `https://<your-project-ref>.supabase.co` (see Supabase dashboard / `.env`)  
- **Two clients:**  
  - `lib/supabase.ts` — anon key, safe for client bundle (`EXPO_PUBLIC_SUPABASE_ANON_KEY`)  
  - `server/supabase.ts` — service role key, server only, bypasses RLS (`SUPABASE_SERVICE_ROLE_KEY`)  
- **Auth:** magic link, PKCE flow, sign-ups disabled, users invited manually  
- **Storage:** private bucket `scores`; service role used for server-side downloads; anon key used for client uploads (policy: authenticated users only)  
- **DB:** single `scores` table, snake\_case columns, no RLS row policies (access controlled at API layer)

### OpenAI

- Model: `gpt-4o-mini` (vision)  
- Used in `POST /api/parse-score` only  
- Image passed as base64 data URL, transiently — never stored  
- Key: `OPENAI_API_KEY` (server-only)

### Vercel

- Production URL: `https://www.slingers.app`  
- Static web export (`npx expo export --platform web`) served from `dist/`  
- `/api/*` routed to `api/index.ts` (Hono serverless function)  
- `EXPO_PUBLIC_*` vars must be set in Vercel dashboard and are baked into the build at compile time — **changing them requires a fresh redeploy with no build cache**

---

## How to Run / Build / Test

### Local development

Copy `.env.example` to `.env` (repo root) and fill it in, then start both servers with one command:

npm run dev   \# runs server:dev + expo:dev together (concurrently)

Or use two terminals (needed for Expo's interactive TUI shortcuts):

\# Terminal 1 — API server on port 5055

npm run server:dev

\# Terminal 2 — Expo dev server on port 8081

npm run expo:dev

Open `http://localhost:8081` in a browser. Metro will take 3–5 minutes on first run (WSL file I/O); subsequent runs use cache.

`http://localhost:5055/` returns 404 — expected. Only `/api/*` routes exist on the server. (Port is 5055, not 5000 — macOS AirPlay Receiver binds 5000.)

### Environment variables (local)

Copy `.env.example` to `.env` and fill in:

OPENAI\_API\_KEY=

SUPABASE\_URL=                      \# https://xxxx.supabase.co

SUPABASE\_SERVICE\_ROLE\_KEY=

EXPO\_PUBLIC\_SUPABASE\_URL=          \# same as SUPABASE\_URL

EXPO\_PUBLIC\_SUPABASE\_ANON\_KEY=

EXPO\_PUBLIC\_DOMAIN=localhost:5055  \# no https://, no trailing slash

### Vercel production env vars

EXPO\_PUBLIC\_DOMAIN=www.slingers.app   \# must match browsing domain, no https://

ALLOWED\_ORIGINS=https://www.slingers.app,https://slingers.app

### Database setup

See `supabase/README.md`. Run SQL files in order via Supabase Dashboard → SQL Editor. Create the `scores` storage bucket manually before running `02_storage_policies.sql`.

### Linting

npm run lint

npm run lint:fix

There are no automated tests.

---

## Conventions

### camelCase vs snake\_case

- All TypeScript code uses **camelCase** (client and server)  
- Supabase DB columns are **snake\_case**  
- `toScore()` in `server/app.ts` is the single mapper between them — always go through it when returning DB rows to the client

### API requests

- Always use `apiRequest()` from `lib/query-client.ts` — it attaches the auth token automatically  
- For read queries use TanStack Query with `queryKey: ['/api/scores']` etc.  
- Never call `fetch()` directly in app screens

### Image handling

- Never store base64 in the database  
- Always upload to Supabase Storage first, store the path, then pass the path to the server  
- To display an image, call `GET /api/scores/:id/image-url` to get a signed URL

### Navigation

- All navigation uses `expo-router` (`useRouter`, `router.push`, `router.back`)  
- Tab screens live in `app/(tabs)/`  
- Modals are Stack screens with `presentation: "modal"` in `app/_layout.tsx`  
- The upload modal receives image data as route params (uri, photoDate, fileName)  
- Never use conditional renders to fake navigation — use the router

### Environment variables

- `EXPO_PUBLIC_*` — safe for client bundle; set in `.env` and Vercel dashboard  
- All others — server-only; never reference in client code or `lib/supabase.ts`  
- `EXPO_PUBLIC_DOMAIN` must be a bare hostname with no protocol and no trailing slash

### Styles

- All styles defined in `StyleSheet.create()` at the bottom of each file  
- Dynamic colors always come from `useTheme()` → `colors` object, never hardcoded  
- Font families: `DMSans_400Regular`, `DMSans_500Medium`, `DMSans_600SemiBold`, `DMSans_700Bold`, `SpaceGrotesk_700Bold`

### Schema changes

No migration CLI. Make changes via Supabase dashboard → SQL Editor, then update `shared/schema.ts` and `toScore()` in `server/app.ts` to match.

---

## What Claude Should Never Do

- **Use Drizzle ORM or `pg` directly** — removed intentionally; Supabase JS client handles all DB access  
- **Store base64 image data in the database** — always use Supabase Storage paths  
- **Expose `SUPABASE_SERVICE_ROLE_KEY` to the client** — it bypasses all RLS; server-side only  
- **Reference `server/supabase.ts` from client code** — it imports the service role key  
- **Set `EXPO_PUBLIC_DOMAIN` with a `https://` prefix** — `getApiUrl()` adds the protocol; double prefix breaks all API calls  
- **Run `npm run db:push`** — this script no longer exists; the command will fail  
- **Use `git push --force` to `main`** — production branch  
- **Run `expo export` or build commands locally** — Vercel handles the build; local dev uses the dev server only  
- **Add new Supabase tables or columns without updating `shared/schema.ts` and `toScore()`** — the mapper must stay in sync with the DB  
- **Recreate `app/index.tsx`** — replaced by the `(tabs)` layout; the old single-file pattern is intentionally gone  
- **Use conditional renders to switch between screens** — use `router.push` / `router.back` and proper Stack/Tab screens

---

## Current Context

See `PROJECT_STATE.md` (same folder) for:

- What is currently in progress  
- Uncommitted changes  
- Immediate next steps  
- Open questions

