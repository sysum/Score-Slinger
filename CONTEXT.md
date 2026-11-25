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
| AI | OpenAI `gpt-4.1-mini` vision | Parses scoreboard images |
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

  ToastContext.tsx      App-level toast — ToastProvider (mounted in app/\_layout.tsx above
                        the Stack, so toasts survive navigation) \+ useToast().showToast(
                        message, { type?: "success" | "error" }). Renders components/Toast.tsx:
                        Reanimated fade/slide, 2.5s auto-dismiss, above the TabBar, never
                        blocks touches; on iOS inside FullWindowOverlay so it sits above modals

lib/

  use-delete-score.ts   useDeleteScore(source) — shared delete flow for History + Score Detail
                        modals: useRef double-tap guard, isDeleting/error state, optional
                        optimistic cache removal + rollback, 404 treated as success, toast,
                        score\_deleted / score\_delete\_failed analytics


  supabase.ts           Client Supabase instance (publishable key in prod / anon demo key locally, PKCE, AsyncStorage)

  query-client.ts       getApiUrl(), apiRequest(), getQueryFn(), QueryClient; non-2xx responses
                        throw ApiError (`.status`, message "<status>: <body>")

  analytics.ts          PostHog wrapper — identify/track/screen/reset; null-safe (no-op if key missing)

server/

  app.ts                All 6 API routes \+ CORS middleware \+ requireAuth middleware

                        toScore() maps snake\_case DB rows → camelCase Score type

  index.ts              Local dev entry point (node-server, port 5055\)

  supabase.ts           Admin Supabase client (secret / service-role key — server only)

shared/

  schema.ts             TypeScript Score type only — source of truth for shape

supabase/

  config.toml           Local Supabase stack config (auth, ports, redirects)

  migrations/           Schema source of truth — scores table, storage bucket \+ policies

  seed.sql              Local seed — test user dev@local.test \+ 2 fake scores

  README.md             Local Supabase workflow guide \+ prod project setup

vercel.json             Build command, output dir, /api/\* routing

---

## External Integrations

### Supabase

- **Production project URL:** `https://<your-project-ref>.supabase.co` (see Supabase dashboard / `.env.prod-reference`)  
- **Local dev uses a local Supabase stack** (Supabase CLI 2.117.0 + Docker) at `http://127.0.0.1:54321`, not the prod project — local testing no longer writes prod data. Chosen over a cloud non-prod project because the org is on the Pro plan, where every project bills compute (~$10/mo); local is $0 and fully isolated. Mirrors the PostHog Non-Prod split in spirit.  
- **Known risk:** Vercel preview deployments still point at the prod Supabase project (local can't serve them).  
- **Two clients:**  
  - `lib/supabase.ts` — publishable key, safe for client bundle (`EXPO_PUBLIC_SUPABASE_ANON_KEY`). Prod uses a new-style **publishable key** (`sb_publishable_…`, a normal non-secret Vercel var for Production + Preview); the variable name is kept for compatibility (code unchanged). Locally it is the local stack's anon demo key  
  - `server/supabase.ts` — admin key, server only, bypasses RLS (`SUPABASE_SERVICE_ROLE_KEY`). Prod uses a new-style Supabase **secret key** (`sb_secret_…`) stored as a Vercel Secret (Sensitive) for Production + Preview; the variable name is kept for compatibility (code unchanged). Locally it is the local stack's service-role demo key from `supabase status -o env`. The project's legacy JWT keys (`anon` + `service_role`) are **disabled** in prod (migration complete 2026-11-24; reversible in Supabase → Settings → API Keys); the old `eyJ…` keys return 401  
- **Auth:** magic link, PKCE flow, sign-ups disabled, users invited manually  
- **Storage:** private bucket `scores`; service role used for server-side downloads; publishable key + user session used for client uploads (policy: authenticated users only)  
- **DB:** single `scores` table, snake\_case columns, no RLS row policies (access controlled at API layer)

### OpenAI

- Model: `gpt-4.1-mini` (vision) — switched from `gpt-4o-mini` on 2026-11-24 after validation (see PROJECT\_STATE.md)  
- Used in `POST /api/parse-score` only  
- Prompt, model and request options live in `server/parsePrompt.ts` (JSON mode on). Player color is identified from each panel's own background/digit color — panel positions vary by ride vehicle and must never be assumed  
- Post-parse sanity checks (4 players, colors exactly blue/yellow/red/purple; players + 3 objectives === teamScore) log `console.warn` and add a `warning` string to the response; they never block the save  
- Image passed as base64 data URL, transiently — never stored  
- Key: `OPENAI_API_KEY` (server-only)

### Vercel

- Production URL: `https://www.slingers.app`  
- Static web export (`npx expo export --platform web`) served from `dist/`  
- `/api/*` routed to `api/index.ts` (Hono serverless function)  
- `EXPO_PUBLIC_*` vars must be set in Vercel dashboard and are baked into the build at compile time — **changing them requires a fresh redeploy with no build cache**

### PostHog

- Client-side product analytics via `posthog-react-native`, wrapped in `lib/analytics.ts` (`identify` / `track` / `screen` / `reset`). The wrapper is **null-safe** — every call is a no-op when `EXPO_PUBLIC_POSTHOG_KEY` is unset.  
- Host defaults to `https://us.i.posthog.com`; override with `EXPO_PUBLIC_POSTHOG_HOST` (set it to `https://eu.i.posthog.com` if the project is in the EU region — a wrong region returns `401` on `/flags/` and silently drops events).  
- Events fire **browser/app → PostHog directly** (they do not pass through the Hono server, so they never appear in server logs).  
- The RN SDK batches: it flushes at 20 queued events, every 30s, or on app-background. In local dev with few events, expect a delay before they appear in PostHog's Activity view.  
- **Local dev + preview use the Non-Prod PostHog project's key; only production uses the prod key.**

#### Event catalog

Naming is `snake_case` `noun_verb`. To add an event, call `analytics.track("name", { props })`; keep names/props consistent with the table below.

| Event | Fires when | Properties |
| :---- | :---- | :---- |
| `signed_in` | Auth session becomes active | — |
| `sign_in_requested` | Magic-link email sent | — |
| `sign_in_failed` | `signInWithOtp` returns an error | `error` |
| `signed_out` | Sign Out tapped (before `reset()`) | — |
| `display_name_set` | Initial display-name setup completed | — |
| `tab_pressed` | Bottom tab tapped (History/Profile) | `tab` |
| `add_score_fab_pressed` | Center FAB tapped | `platform` |
| `add_score_source_selected` | Take Photo / Choose from Library tapped | `source` (`camera`\|`library`) |
| `add_score_sheet_dismissed` | Add-score action sheet cancelled/overlay | — |
| `image_permission_denied` | Camera/library permission refused | `source` |
| `image_pick_canceled` | System picker dismissed with no selection | `source` |
| `image_selected` | Image chosen from camera/library | `source` |
| `image_pick_failed` | Picker threw | `source`, `error` |
| `duplicate_warning_shown` | Same-timestamp score detected pre-parse | — |
| `duplicate_upload_confirmed` | "Upload Anyway" tapped | — |
| `duplicate_upload_canceled` | Duplicate warning dismissed | — |
| `score_parse_started` | Parse request sent to `/api/parse-score` | — |
| `score_parse_succeeded` | Parse returned a valid result | — |
| `score_parse_failed` | Parse errored | `error` |
| `parse_error_dismissed` | "Go Back" tapped on the parse-error screen | — |
| `score_saved` | Parsed score persisted | — |
| `score_kept` | "Done" tapped, keeping the saved score | `scoreId` |
| `score_discarded` | Upload discarded (deletes the saved record) | — |
| `played_date_edit_started` | Played-date editor opened | — |
| `played_date_changed` | Played date saved | — |
| `player_name_edit_started` | A player-name field opened for editing | `location` (`upload`\|`detail`) |
| `player_names_updated` | A player name label saved | — |
| `history_sort_opened` | History sort picker opened | — |
| `history_sort_changed` | History sort option chosen | `sort` |
| `history_pull_refreshed` | Pull-to-refresh on the history list | `platform` |
| `card_swiped_open` | Swipe-to-delete reveals the delete action | `platform` |
| `score_detail_viewed` | History card opened | `source`, `scoreId` |
| `score_detail_closed` | Score detail back/close tapped | `scoreId` |
| `score_delete_requested` | Delete initiated (opens confirm) | `via` (`swipe`\|`detail_button`), `scoreId?` |
| `score_delete_canceled` | Delete confirm dismissed | `source` (`history`\|`detail`), `scoreId?` |
| `score_deleted` | Delete confirmed and completed (fires once per success; a 404 counts as success) | `source`, `scoreId`, `already_deleted?` (`true` only when the server returned 404) |
| `score_delete_failed` | Delete request failed (non-404 error); modal stays open for retry | `source` (`history`\|`detail`), `scoreId`, `error` |
| `appearance_changed` | Theme changed in Profile | `mode` (`dark`\|`light`\|`system`) |
| `date_format_changed` | Date format changed in Profile | `format` |
| `default_sort_changed` | Default sort changed in Profile | `sort` |
| `display_name_edit_started` | Display-name edit opened in Profile | — |
| `display_name_changed` | Display name saved in Profile | — |

Plus `analytics.identify(userId, { email, name })` on sign-in, `analytics.screen("/score/:id")` on detail view, and `analytics.reset()` on sign-out.

---

## How to Run / Build / Test

### Local development

Copy `.env.example` to `.env` (repo root) and fill it in. Docker Desktop must be running. Start the local Supabase stack first (cold start ~30s; intentionally not chained into `npm run dev`):

npm run db:start   \# supabase start — also db:stop, db:status, db:reset (re-applies migrations \+ seed; wipes local data)

Local endpoints: API `http://127.0.0.1:54321`, Postgres `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, Studio `http://127.0.0.1:54323`, Mailpit (local inbox for magic-link emails) `http://127.0.0.1:54324`. Sign in as the seeded user `dev@local.test` via magic link, opened from Mailpit. Prod users don't exist locally; add more via Studio → Authentication → Add user (auto-confirm).

Then start both servers with one command:

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

SUPABASE\_URL=                      \# http://127.0.0.1:54321 (local stack)

SUPABASE\_SERVICE\_ROLE\_KEY=         \# from `supabase status -o env` (local demo key, not a secret)

EXPO\_PUBLIC\_SUPABASE\_URL=          \# same as SUPABASE\_URL

EXPO\_PUBLIC\_SUPABASE\_ANON\_KEY=     \# from `supabase status -o env`

EXPO\_PUBLIC\_DOMAIN=localhost:5055  \# no https://, no trailing slash

Prod Supabase values are kept in `.env.prod-reference` (gitignored by `.env*`; deliberately NOT an Expo-recognised name like `.env.production.local`, which `expo export` would auto-load and bake prod into a local build). Switching to prod is a deliberate `cp .env.prod-reference .env`. `OPENAI_API_KEY` and the Non-Prod PostHog key are the same either way.

Native caveat: iOS Simulator reaches `127.0.0.1`; Android emulator needs `10.0.2.2:54321`; a physical phone needs the Mac's LAN IP in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_DOMAIN`. Device testing against local is a follow-up.

### Vercel production env vars

EXPO\_PUBLIC\_DOMAIN=www.slingers.app   \# must match browsing domain, no https://

ALLOWED\_ORIGINS=https://www.slingers.app,https://slingers.app

### Database setup

See `supabase/README.md`. Local: `npm run db:start` applies `supabase/migrations/` and `seed.sql` automatically; the private `scores` bucket is created in SQL (no manual dashboard step). The migrations mirror live prod exactly. (The old `01_scores_table.sql` / `02_storage_policies.sql` were removed — they had drifted from prod: a text→uuid `user_id` FK that fails, `played_date timestamptz` vs prod `text`, missing `game_name default 'Unknown'`, different storage policy names.) Prod's existing schema predates the migrations folder. Optional drift check: `supabase link --project-ref <your-project-ref> && supabase db diff --linked`.

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

Schema lives in `supabase/migrations/`. Create a migration with `supabase migration new <name>`, test it locally with `npm run db:reset`, then apply it to prod via the dashboard SQL Editor (or Supabase MCP `apply_migration`). Update `shared/schema.ts` and `toScore()` in `server/app.ts` to match.

---

## What Claude Should Never Do

- **Use Drizzle ORM or `pg` directly** — removed intentionally; Supabase JS client handles all DB access  
- **Store base64 image data in the database** — always use Supabase Storage paths  
- **Expose `SUPABASE_SERVICE_ROLE_KEY` to the client** — it bypasses all RLS; server-side only  
- **Reference `server/supabase.ts` from client code** — it imports the server-only admin (secret) key  
- **Set `EXPO_PUBLIC_DOMAIN` with a `https://` prefix** — `getApiUrl()` adds the protocol; double prefix breaks all API calls  
- **Run `npm run db:push`** — this script no longer exists; the command will fail  
- **Point the local `.env` at prod casually** — local dev uses the local Supabase stack; switching to prod (`cp .env.prod-reference .env`) must be deliberate  
- **Run `supabase db reset` against a linked prod project (`--linked`)** — it wipes the database; only run `npm run db:reset` against the local stack  
- **Commit `.env.prod-reference`** — it holds prod secrets (it is gitignored via `.env*`; keep it that way)  
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

