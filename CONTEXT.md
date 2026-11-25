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

### API routes (`server/app.ts`)

All require `Authorization: Bearer <supabase_jwt>` (`requireAuth` middleware).

| Method | Route | Description |
| :---- | :---- | :---- |
| POST | `/api/parse-score` | `{ imagePath }` → OpenAI vision → parsed JSON (+ `warning?`, `photoTakenDate?`, `model`) |
| GET | `/api/scores` | All scores, `created_at` DESC |
| POST | `/api/scores` | Save a parsed score (auto-saved by the upload screen on parse success) |
| PATCH | `/api/scores/:id/player-names` | Update player name labels (any authed user — intentional) |
| PATCH | `/api/scores/:id/played-date` | `{ playedDate }` → stored normalized as an ISO string (`played_date` is TEXT); 400 if unparseable; owner only (403), 404 if missing |
| GET | `/api/scores/:id/image-url` | 60s signed URL for the private image |
| DELETE | `/api/scores/:id` | Delete score (owner only — checks `user_id`), then best-effort remove its `image_path` object from Storage (logged, never fails the request) |

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

1. FAB tap → camera action sheet → `router.push("/upload", { uri, photoDate, fileName, source, photoDateSource })` (`source` = `camera`\|`library` and `photoDateSource` = `exif`\|`now` are analytics-only)  
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
                        throw ApiError (`.status`, message "<status>: <body>") and fire
                        `api_request_failed` (+ `$exception` for 5xx; see isCapturedApiError)

  analytics.ts          PostHog wrapper — client options, super props, identifyUser/track/screen/
                        captureException/setPersonProperties/reset; null-safe (no-op if key missing)

server/

  app.ts                All 7 API routes \+ CORS middleware \+ requireAuth middleware

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
- Static web export (`npx expo export --platform web`) served from `dist/`. The `vercel.json` build command prefixes it with `EXPO_PUBLIC_VERCEL_ENV=$VERCEL_ENV EXPO_PUBLIC_COMMIT_SHA=$VERCEL_GIT_COMMIT_SHA` so the PostHog `environment` / `commit` super props get baked in (Vercel system vars aren't `EXPO_PUBLIC_*`, so Expo wouldn't inline them otherwise)  
- `/api/*` routed to `api/index.ts` (Hono serverless function)  
- `EXPO_PUBLIC_*` vars must be set in Vercel dashboard and are baked into the build at compile time — **changing them requires a fresh redeploy with no build cache**

### PostHog

- Client-side product analytics via `posthog-react-native` (4.46.x), wrapped in `lib/analytics.ts` (`identifyUser` / `track` / `screen` / `captureException` / `setPersonProperties` / `reset`). The wrapper is **null-safe** — every call is a no-op when `EXPO_PUBLIC_POSTHOG_KEY` is unset. Bare client only — **no `PostHogProvider`** (its screen autocapture doesn't work with expo-router).  
- Host defaults to `https://us.i.posthog.com`; override with `EXPO_PUBLIC_POSTHOG_HOST` (set it to `https://eu.i.posthog.com` if the project is in the EU region — a wrong region returns `401` on `/flags/` and silently drops events).  
- Events fire **browser/app → PostHog directly** (they do not pass through the Hono server, so they never appear in server logs).  
- **Batching:** `flushAt` is 1 in dev (every event sends immediately) and 5 in prod, `flushInterval` 5s, plus a flush on every app-state change. (SDK defaults are 20 events / 10s.) `preloadFeatureFlags: false` and `disableSurveys: true` — neither is used, so their round-trips are skipped. `captureAppLifecycleEvents` stays on (the default lifecycle events listed under the catalog).  
- **Super properties** (`register()`, on every event): `platform` (`Platform.OS`), `environment` (`EXPO_PUBLIC_VERCEL_ENV` — `production`/`preview` on Vercel — else `development` in dev / `production`), `app_version` (`expoConfig.version`), `commit` (first 7 chars of `EXPO_PUBLIC_COMMIT_SHA`, Vercel builds only). `reset()` wipes super props, so `analytics.reset()` re-registers them.  
- **Identify / person properties:** `AuthGate` (`app/_layout.tsx`) identifies once per app run per user from the `onAuthStateChange` listener (no separate `getSession()` call — `INITIAL_SESSION` covers it), with `$set: { email, display_name }` and `$set_once: { first_seen_at }`. Email and display name are stored on person profiles by decision. `display_name` is re-set via `setPersonProperties` when it's first set (`DisplayNameSetup`) or changed (Profile). `SIGNED_OUT` (incl. expiry / another tab) and Profile's Sign Out both call `analytics.reset()`.  
- **`signed_in` detection:** fires only when PostHog's persisted distinct ID changes from anonymous to the user (`identifyUser()` resolves `true`) — i.e. a real sign-in, never a reload, token refresh, `USER_UPDATED`, or web tab refocus. It is deliberately **not** keyed on the Supabase `SIGNED_IN` event: Supabase also emits `SIGNED_IN` when restoring a stored session and on every web tab refocus, and the web magic-link `SIGNED_IN` can fire before the listener subscribes.  
- **Screen tracking:** `RootLayoutNav` calls `analytics.screen()` whenever expo-router's `usePathname()` changes. Names = route path without the leading slash, `/` → `history`, dynamic segments as their pattern: `history`, `profile`, `upload`, `score/[id]` (prop `score_id`). `AuthScreen` and `DisplayNameSetup` render outside the Stack and fire `auth` / `display_name_setup` on mount. Don't add per-screen `analytics.screen()` calls elsewhere (double counting).  
- **Error capture:** the root `<ErrorBoundary onError>` sends caught render errors via `captureException(error, { component_stack })`. `lib/query-client.ts` `throwIfResNotOk` (the single choke point for non-2xx API responses, used by `apiRequest` and the default query fn) fires `api_request_failed` and, for 5xx, `captureException(error, { route, method, status })`. Catch blocks call `captureException(err, { context, … })` where there's no HTTP status to go on or the error is otherwise swallowed: non-HTTP player-name PATCH failures, unexpected non-HTTP errors in the upload flow, errors after the auto-save succeeded (`post_save`), and a failed cleanup DELETE after a mid-save cancel (`upload_cancel_cleanup`), skipping 5xx already captured upstream (`isCapturedApiError`). SDK autocapture: `uncaughtExceptions` (RN `ErrorUtils` — native only) and `unhandledRejections` on, `console` off (explicit `*_failed` events already cover handled errors). Autocapture is ignored if the PostHog project's remote config disables exception autocapture (Project settings → Error tracking).  
- **Deliberately off:** session replay (deferred), and internal-user filtering (the owner's own usage is kept).  
- `EXPO_PUBLIC_POSTHOG_DEBUG=true` turns on SDK debug logging (`posthog.debug(true)`).  
- **Local dev + preview use the Non-Prod PostHog project's key; only production uses the prod key.**

#### Event catalog

Naming is `snake_case` `noun_verb`; property names are `snake_case` (all events use `score_id` since PostHog Phase 2; the old `scoreId` prop is gone, so filter older data on both). To add an event, call `analytics.track("name", { props })`; keep names/props consistent with the table below. Props marked "or null" are always sent, as `null` when unknown.

| Event | Fires when | Properties |
| :---- | :---- | :---- |
| `signed_in` | Real sign-in only: a session appears for a user PostHog hasn't identified on this device (not on reload / token refresh) | `method` (`magic_link`), `platform` |
| `sign_in_requested` | Magic-link email sent | — |
| `sign_in_failed` | `signInWithOtp` returns an error | `error` |
| `signed_out` | Sign Out tapped (before `reset()`) | — |
| `app_reloaded_for_update` | Web prod only (`lib/version-check.ts`): just before the page reloads onto a newer deploy (stale-bundle guard), or after a "Legacy API keys are disabled" auth error. Flushed (≤500 ms) before reload | `reason` (`new_bundle`\|`legacy_key_error`), `from_entry` (loaded `/_expo/static/js/web/entry-*.js` path), `to_entry` (newer entry path; null for `legacy_key_error`) |
| `display_name_set` | Initial display-name setup completed | — |
| `tab_pressed` | Bottom tab tapped (History/Profile) | `tab` |
| `add_score_fab_pressed` | Center FAB tapped | `platform` |
| `add_score_source_selected` | Take Photo / Choose from Library tapped | `source` (`camera`\|`library`) |
| `add_score_sheet_dismissed` | Add-score action sheet cancelled/overlay | — |
| `image_permission_denied` | Camera/library permission refused | `source` |
| `image_pick_canceled` | System picker dismissed with no selection | `source` |
| `image_selected` | Image chosen from camera/library | `source` |
| `image_pick_failed` | Picker threw | `source`, `error` |
| `duplicate_warning_shown` | Same-timestamp score detected pre-upload | — |
| `duplicate_upload_confirmed` | "Upload Anyway" tapped | — |
| `duplicate_upload_canceled` | Duplicate warning dismissed | — |
| `image_upload_started` | Upload to Supabase Storage begins (after the duplicate check; not sent for HEIC rejected on web). On web it fires after the image blob is read, since `ext` comes from the blob's MIME type | `ext`, `source` (`camera`\|`library`, or null) |
| `image_upload_succeeded` | Storage upload finished | `ext`, `bytes` (image size; web `blob.size`, native decoded byte length), `source` |
| `image_upload_failed` | Reading the image or the Storage upload failed (no parse is attempted) | `ext`, `bytes` (or null if the read failed), `source`, `error` |
| `score_parse_started` | Parse request sent to `/api/parse-score` (only after `image_upload_succeeded`) | — |
| `score_parse_succeeded` | Parse returned a valid result | `duration_ms` (parse request round trip), `warning` (server sanity-check text, or null), `has_exif_date` (EXIF date found server- or client-side), `has_achievement`, `team_score`, `model` (e.g. `gpt-4.1-mini`) |
| `score_parse_failed` | Parse or the auto-save failed after a successful upload | `stage` (`parse`\|`save`\|`network`), `status` (HTTP status from `ApiError`, or null), `error`. `parse` + null status = the server answered 200 with `{ error }` (unreadable board) |
| `upload_canceled` | Upload screen closed (X, or unmounted e.g. swipe-down / Android back) while the analysis was still running. No later flow event fires for that upload; a save already in flight is deleted | `stage` (`upload`\|`parse`\|`save` — the step running when canceled) |
| `parse_error_dismissed` | "Go Back" tapped on the parse-error screen | — |
| `score_saved` | Parsed score auto-saved (`POST /api/scores`) — **before** the user keeps or discards it (see note below) | `score_id` (null only if the save response was unreadable and the id couldn't be recovered from history), `source`, `played_date_source` (`exif_server`\|`exif_client`\|`now`), `played_date_age_days` (whole days between played date and save), `duplicate_overridden`, `history_size` (shared history count incl. this score — all users, no per-user filter; null if not cached), plus gameplay: `team_score`, `achievement` (or null), `objective_fight_giant_bot`, `objective_rescue_spider_man`, `objective_destroy_giant_bot`, `score_blue`, `score_yellow`, `score_red`, `score_purple`, `top_color` (color of the highest player score; first in parse order on a tie) |
| `score_kept` | "Done" tapped, keeping the saved score | `score_id`, `had_warning`, `names_edited_count` (colors with a custom name), `date_edited` |
| `score_discarded` | Discard / close (X) tapped and the saved record was deleted (a 404 counts as deleted) | `score_id`, `had_warning`, `names_edited_count`, `date_edited` |
| `score_discard_failed` | Discard DELETE failed (non-404); the screen stays open with an inline error for retry | `score_id`, `status` (HTTP status, or null for network/other), `error` |
| `played_date_edit_started` | Played-date editor opened | — |
| `played_date_changed` | Played date saved (persisted via `PATCH /api/scores/:id/played-date` when the score was auto-saved; local-only otherwise). Upload screen only — Score Detail has no date editor | `location` (`upload`), `score_id` (null if the auto-save failed), `delta_minutes` (new minus old, rounded) |
| `played_date_change_failed` | Played-date PATCH failed (modal stays open with inline error) | `location` (`upload`), `score_id`, `error` |
| `player_name_edit_started` | A player-name field opened for editing | `location` (`upload`\|`detail`) |
| `player_names_updated` | A player name label saved to the server (not sent if the PATCH fails, or on upload when the auto-save failed) | `location` (`upload`\|`detail`), `score_id`, `color` |
| `player_names_update_failed` | Player-name PATCH failed; the label reverts and an error toast shows | `location` (`upload`\|`detail`), `score_id`, `status` (HTTP status, or null for network/other) |
| `history_loaded` | History tab's score list first arrives (once per mount) | `count`, `is_empty` |
| `history_sort_opened` | History sort picker opened | — |
| `history_sort_changed` | History sort option chosen (also updates the `default_sort` person property — same stored setting) | `sort` |
| `history_pull_refreshed` | Pull-to-refresh on the history list | `platform` |
| `card_swiped_open` | Swipe-to-delete reveals the delete action | `platform` |
| `score_detail_viewed` | History card opened | `source`, `score_id`, `is_own` (uploader name matches the viewer's display name — same rule as delete permission), `has_image` |
| `score_detail_closed` | Score detail back/close tapped | `score_id` |
| `score_delete_requested` | Delete initiated (opens confirm) | `via` (`swipe`\|`detail_button`), `score_id` |
| `score_delete_canceled` | Delete confirm dismissed | `source` (`history`\|`detail`), `score_id` |
| `score_deleted` | Delete confirmed and completed (fires once per success; a 404 counts as success) | `source`, `score_id`, `already_deleted?` (`true` only when the server returned 404) |
| `score_delete_failed` | Delete request failed (non-404 error); modal stays open for retry | `source` (`history`\|`detail`), `score_id`, `error` |
| `api_request_failed` | Any API call got a non-2xx response (fired in `throwIfResNotOk`; network errors with no response are not included) | `route` (normalized, e.g. `/api/scores/:id/image-url`), `method`, `status` |
| `appearance_changed` | Theme changed in Profile | `mode` (`dark`\|`light`\|`system`) |
| `date_format_changed` | Date format changed in Profile | `format` |
| `default_sort_changed` | Default sort changed in Profile | `sort` |
| `display_name_edit_started` | Display-name edit opened in Profile | — |
| `display_name_changed` | Display name saved in Profile | — |

**Keep/discard note:** the upload screen auto-saves on parse success, so `score_saved` counts every parsed score, including ones later discarded. Exclude discards with `score_discarded` (same `score_id`). Neither `score_kept` nor `score_discarded` fires if the modal is dismissed another way (iOS swipe-down, Android back), and the score then stays saved — so "saved minus discarded" is the true count of kept scores, not `score_kept`. A failed discard DELETE keeps the screen open with an inline error and fires `score_discard_failed` instead of `score_discarded`. Closing mid-analysis fires `upload_canceled`, and no `score_saved` (a save already in flight is deleted).

**Failure accounting:** a Storage upload failure is `image_upload_failed`, not `score_parse_failed` (before Phase 2 it was logged as a parse failure). An HTTP error on parse/save fires both `score_parse_failed` (flow context) and `api_request_failed` (route/status).

**Person properties:** `email`, `display_name`, `first_seen_at` (identify); `display_name` (on set/change); `theme`, `date_format`, `default_sort` (set when the matching preference changes — users who never changed a setting have none).

SDK / automatic events (not from `track()`):

- `$identify` (or `$set` when re-identifying the same user) — from `analytics.identifyUser()`; person props `email`, `display_name`, `first_seen_at`. `analytics.setPersonProperties(...)` also emits `$set`.
- `$screen` — `$screen_name` is one of `history`, `profile`, `upload`, `score/[id]` (+ `score_id`), `auth`, `display_name_setup` (see Screen tracking above).
- `$exception` — `ErrorBoundary` render errors (`component_stack`), 5xx API responses (`route`, `method`, `status`), catch blocks (`context`: `player_names_update` / `analyze_image` / `post_save` / `upload_cancel_cleanup`), plus SDK autocapture (uncaught errors on native, unhandled promise rejections).
- `Application Opened` / `Application Became Active` / `Application Backgrounded` / `Application Installed` / `Application Updated` — lifecycle defaults.

`analytics.reset()` runs on sign-out.

#### Insights to build (PostHog UI)

- **Upload funnel:** `add_score_fab_pressed` → `add_score_source_selected` → `image_selected` → `image_upload_succeeded` → `score_parse_succeeded` → `score_saved` → `score_kept`; 10-minute conversion window; breakdown by `source` and `platform`. (Duplicate-warning cancels drop out between `image_selected` and `image_upload_succeeded`.)
- **Sign-in funnel:** `sign_in_requested` → `signed_in`.
- **Parse quality:** warning rate (`score_parse_succeeded` where `warning` is set ÷ all `score_parse_succeeded`); discard rate (`score_discarded` ÷ `score_saved`); name-correction rate (`score_kept` where `names_edited_count` > 0 ÷ `score_kept`, or `player_names_updated` with `location = upload`); `duration_ms` p50/p95 on `score_parse_succeeded`.
- **Retention:** monthly retention on `score_saved`.
- **Errors:** `$exception` trends; `score_parse_failed` broken down by `stage`; `api_request_failed` broken down by `route` and `status`; `image_upload_failed` count.
- **Gameplay stats** (on `score_saved`, ideally excluding discarded `score_id`s): average `team_score`; `top_color` distribution; averages of `score_blue` / `score_yellow` / `score_red` / `score_purple` and the three `objective_*` props.

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
- The upload modal receives image data as route params (uri, photoDate, fileName, plus analytics-only source, photoDateSource)  
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

