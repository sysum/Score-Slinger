# Score Slinger — Project State

Last updated: 2026-11-25

---

## Current Goal

Sentry Phase 2 (client SDK + PostHog error-capture split) and Phase 3 (source maps in the Vercel build) are implemented on `feat/sentry-client`; see `docs/SENTRY_PLAN.md`. Sentry Phase 1 (server) is live and verified in production. PostHog Phase 3 (`posthog-node` server-side events) and Sentry Phase 4 (optional on-error replay) follow.

---

## In Progress

### Sentry Phase 2: client SDK + PostHog error-capture split (branch `feat/sentry-client`, 2026-11-25 — not pushed)

Details: **CONTEXT.md → Observability (Sentry)**; plan in `docs/SENTRY_PLAN.md`.

- **Package:** `@sentry/react-native` pinned to **8.35.0** (published 2026-11-12, 13 days old). `npx expo install` picked ~7.11.0 (Jan 2026): Expo's `bundledNativeModules.json` never moved past it (same in SDK 57), and 7.11.0 has neither `expoRouterIntegration` nor SDK 56 `expo/fetch` support (8.14.0+). 8.36.0 was only 8 days old. `package.json` → `expo.install.exclude` stops `expo install --check` / expo-doctor flagging the newer version.
- **New:** `lib/monitoring.ts` (Sentry.init only when `EXPO_PUBLIC_SENTRY_DSN` is set; `captureException` / `setMonitoringUser` / `clearMonitoringUser`; exports `APP_ENVIRONMENT`, now also PostHog's `environment`), `lib/api-url.ts` (`getApiUrl()` split out so monitoring doesn't import query-client). `server/scrub.ts` moved to `shared/scrub.ts`, used by both sides.
- **`app/_layout.tsx`:** `@/lib/monitoring` is the first import; `export default Sentry.wrap(RootLayout)`; ErrorBoundary → `captureException` with `contexts.react.componentStack`; Sentry user (id + display name, never email) set where PostHog identifies and cleared where `analytics.reset()` runs (also Profile's Sign Out).
- **PostHog split:** exception autocapture off, `analytics.captureException` removed, every call site (query-client 5xx, ErrorBoundary, upload catch blocks, detail player names) moved to `monitoring.captureException` with the same context as tags. `isCapturedApiError` dedupe unchanged. `*_failed` events stay and gain `request_id`.
- **Request correlation:** every API request sends `X-Request-Id` (`expo-crypto`); `ApiError.requestId` comes from the response header; `api_request_failed`, `score_parse_failed`, `player_names_update_failed`, `score_discard_failed`, `played_date_change_failed`, `score_delete_failed` carry `request_id`; 5xx Sentry events are tagged with it. `tracePropagationTargets` matches only `${getApiUrl()}/api/` (never Supabase).
- **`expo/fetch` finding:** on web `expo/fetch` is `globalThis.fetch` captured at module load (`node_modules/expo/src/winter/fetch/fetch.web.ts:1`), while Sentry instruments by replacing `globalThis.fetch` in `Sentry.init` (`@sentry/core` `instrument/fetch.js:25`). A captured reference can predate the patch, so `query-client` now calls `globalThis.fetch` at request time (on native SDK 56 that's expo/fetch anyway).
- **Bundle:** `metro.config.js` → `getSentryExpoConfig` (no web replay/feedback, no `annotateReactComponents` because of the React Compiler) plus a resolver that dedupes `@sentry/core` (npm nests a 10.x copy under each client `@sentry/*` package because the server's 11.x is hoisted). Dev-server minified prod bundle: 8.17 MB → 6.73 MB (gzip 1.81 → 1.46 MB).
- **Verified locally:** tsc 0 errors, lint clean, expo-doctor same 3 pre-existing failures, `npm audit --omit=dev` no new highs (2 new moderates: `glob` via `@sentry/bundler-plugins`). Dev-server web bundle compiles, contains one `@sentry/core` copy, no `@sentry/replay` / `@sentry-internal/feedback`, and no `expo/fetch`.
- **Needs the user:** `EXPO_PUBLIC_SENTRY_DSN` in Vercel (Production + Preview), redeploy without build cache, verify on a preview (checklist in the PR / hand-off).

---

## Recently Completed (shipped to `main`)

### Sentry Phase 1: server (PR #19, merged 2026-11-25 — live, verified in production)

Plan, decisions, quota math and PII rules: `docs/SENTRY_PLAN.md`. Details of the implementation: **CONTEXT.md → Observability (Sentry)**.

- **Why:** Vercel Hobby keeps runtime logs for 1 hour; the 2026-11-25 upload incident had to be pieced together from Supabase logs. Sentry (free plan, project `score-slinger-api`) keeps errors, traces and logs.
- **Packages:** `@sentry/hono` + `@sentry/node`, both pinned to exactly `11.12.0` (the newest release ≥2 weeks old at install time; avoid pinning brand-new releases). (`@hono/sentry` and the `honoIntegration` approach are deprecated.) Needs Node ≥20.19 / ≥22.12. No `engines` in `package.json`; the Vercel project's Node version must be 22.x or 24.x.
- **New files:** `server/instrument.ts` (`Sentry.init` from `@sentry/hono/node`, first import of `api/index.ts` + `server/index.ts`), `server/log.ts` (structured logger over `Sentry.logger`, scrubbed `console.log` mirror), `server/scrub.ts` (redaction).
- **`server/app.ts`:** `sentry(app)` first, then a request-id middleware (`X-Request-Id` in/out, tags + attributes `request_id` / `route` / `method`, one `request.completed` access log per request), CORS allows `sentry-trace` / `baggage` / `X-Request-Id` and exposes `X-Request-Id`, `requireAuth` sets the Sentry user (id + display name, no email). All 14 `console.*` calls are now structured log events. Catch-alls go through `fail()`, which reports to Sentry and adds `requestId` to the 500 body. **Status codes and `error` strings are unchanged.**
- **Decisions (user):** two Sentry projects (`score-slinger-web` later, `score-slinger-api` now); no email in Sentry; log the raw OpenAI reply (≤2 KB) at info; PostHog `*_failed` events stay; no replay; previews report too (environment from `VERCEL_ENV`); $0 plan, and a missing `SENTRY_DSN` means a silent no-op (local default).
- **Deviation from the plan:** the `route` tag comes from Hono's matched route list (first non-middleware match), because `c.req.routePath` inside a `*` middleware returns `*`. Also added: a fallback isolation-scope fork if the runtime ever doesn't create one per request, and a console mirror of every log line so local dev without a DSN still shows server logs.
- **Verified locally:** tsc 0 errors, `expo lint` clean, `npm audit --omit=dev` unchanged (no new advisories). The server boots with no DSN and an unauthenticated `GET /api/scores` returns 401 with `X-Request-Id`. Against a fake ingest with a dummy DSN: requests produce `GET /api/scores` transactions and `request.completed` logs carrying `request_id` / `route` / `method`; no OPTIONS spans; no IP, headers, cookies or query strings; JWTs, `sb_*` keys, `sk-…`, `token=` / `code=` and `data:image` strings all arrive redacted.
- **Status:** merged as PR #19 and verified in production: logs, traces and errors reach `score-slinger-api` (org `team-beam`). `server/scrub.ts` has since moved to `shared/scrub.ts` (Phase 2).

### Stale-bundle reload guard (PR #18, merged 2026-11-25 — live)

A Chrome tab open since before the prod publishable-key swap kept running the old bundle; its refresh hit 401 "Legacy API keys are disabled", logging the user out and failing every magic link. `lib/version-check.ts` (web prod only) re-fetches `/` on tab show and every 10 min, compares the `entry-*.js` src, and reloads when safe (not on `/upload`, no focused input; auth screen always safe). It also checks before sending a magic link, on `SIGNED_OUT`, and reloads on a legacy-key auth error (sessionStorage guard: once per 5 min). Tracks `app_reloaded_for_update`.

### Upload flow bug fixes (PR #17, merged 2026-11-25 — live)

- **X mid-analysis cancels** (`app/upload.tsx`): `analyzeImage` registers a cancel callback (`cancelAnalysisRef`), also fired on unmount (iOS swipe-down / Android back). After every await it stops if canceled: no further requests, no flow events, no setState. Canceled before the save → save skipped; save already in flight → the new record is deleted (best-effort; server then removes its image). Fires `upload_canceled { stage }`. **Known gap:** an image uploaded before a pre-save cancel stays orphaned — the bucket has no client delete policy (`supabase/migrations/…storage…`), and only the server DELETE cleans images. Fixing it needs a storage delete policy or a server endpoint (schema/API change, not done).
- **Failed discard is no longer silent:** the screen stays open with a spinner ("Discarding…"; X/Done disabled, ref guard against double-taps), and on failure shows an inline error by the Discard button (scrolls to it) so the user can retry or keep with Done. A 404 counts as success. Mirrors `lib/use-delete-score.ts` rather than reusing it — the hook fires `score_deleted` + a "Score deleted" toast, while discard must fire `score_discarded`. New `score_discard_failed`; the old `$exception` (`context: "score_discard"`) is gone.
- **Failed player-name PATCH** (upload + detail): reverts that color's label (unless edited again meanwhile), error toast "Couldn't save the name — …", new `player_names_update_failed { location, score_id, status }`. `captureException` now only for non-HTTP errors (HTTP ones already have `api_request_failed`).
- **Post-save errors never show the failure screen** (user incident 2026-11-25 03:12 / 03:40 UTC: Supabase logs show upload 200, download 200, `POST /rest/v1/scores` 201, yet the user saw "Failed to analyze image"). Once `POST /api/scores` returns 2xx, the rest (`saveRes.json()`, setState, `score_saved`, haptics) is wrapped: errors go to `captureException({ context: "post_save" })` and the result is shown. If the response body can't be read, the id is recovered by refetching history and matching `imagePath` (paths are unique); if that also fails the result shows without an id and the Discard button is hidden (nothing to delete). Haptics are fire-and-forget (`successHaptic()`), sync and async errors swallowed.
- **Web file extension fixed:** web URIs are `blob:https://…/<uuid>`, so `split(".")` gave `"app/<uuid>"` — prod paths look like `scores/…-xyz.app/<uuid>`, the web HEIC check never fired and `ext` analytics were garbage. Web now reads the blob first and derives `ext` from its MIME type (→ `fileName` param → `jpg`); HEIC is rejected before upload. Native unchanged. Existing prod paths not migrated (`image_path` is stored verbatim, so old rows still work). Side effect: on web, `image_upload_started` now fires after the image is read.
- **Orphaned images** (`server/app.ts`): `DELETE /api/scores/:id` fetches `image_path` in the ownership check and, after the row is deleted, removes the object from `scores` (logged, never fails the request). Existing prod orphans untouched — cleanup needs separate user approval.

**Status:** merged as PR #17 and live. Originally stacked on #16 because both rewrite `app/upload.tsx`.

### PostHog Phase 2: taxonomy + richer props (PR #16, merged 2026-11-25 — live)

Client-side only, apart from one server line. Full event/property list in **CONTEXT.md → PostHog → Event catalog**, plus an "Insights to build" list (upload + sign-in funnels, parse quality, retention, errors, gameplay stats).

- **`scoreId` → `score_id`** on every event (`score_kept`, `score_detail_viewed/closed`, `score_delete_requested/canceled`, `score_deleted`, `score_delete_failed`). History's swipe `score_delete_requested` and `score_delete_canceled` now also carry `score_id`.
- **Upload split out of parse** (`app/upload.tsx`): new `image_upload_started/succeeded/failed { ext, bytes, source }`; `score_parse_started` now fires only after a successful upload. A Storage failure used to be logged as `score_parse_failed` — parse-failure counts drop accordingly.
- **`score_parse_succeeded`** `{ duration_ms, warning, has_exif_date, has_achievement, team_score, model }`. Client `ParsedResult` now types `warning` / `model`; `/api/parse-score` echoes `model: PARSE_MODEL` (the only server change).
- **`score_parse_failed`** `{ stage: parse|save|network, status, error }`. "network" = the request threw with no HTTP response (tracked by wrapping `apiRequest` in the flow, not by error-class sniffing).
- **`score_saved`** `{ score_id, source, played_date_source (exif_server|exif_client|now), played_date_age_days, duplicate_overridden, history_size }` + flat gameplay props (`team_score`, `achievement`, three `objective_*`, `score_blue/yellow/red/purple`, `top_color`). **Decision (user):** track team scores and per-color scores in analytics as flat props; `score_parse_succeeded` gets `team_score` only to avoid double counting. `source` and `photoDateSource` (exif|now) are new analytics-only router params from `components/TabBar.tsx`.
- **`score_kept` / `score_discarded`** `{ score_id, had_warning, names_edited_count, date_edited }`. Documented that `score_saved` fires before keep/discard (auto-save), so discards must be excluded.
- **`player_names_updated`** `{ location, score_id, color }` (upload + detail); **`played_date_changed`** adds `delta_minutes` (upload only — detail has no date editor).
- **New `api_request_failed { route, method, status }`** at the single choke point `throwIfResNotOk` (`lib/query-client.ts`), route normalized to `/api/scores/:id/...`; 5xx also `captureException`. Network errors (no response) are not included.
- **New `history_loaded { count, is_empty }`** once per History mount; **`score_detail_viewed`** adds `is_own` (display-name match, same rule as delete permission) and `has_image`.
- **Preferences as person properties:** `theme`, `date_format`, `default_sort` via `setPersonProperties` alongside the Profile events. History's sort picker writes the same stored setting, so it also sets `default_sort`.
- **Swallowed catches** (player-name PATCH on upload/detail, discard DELETE, unexpected non-HTTP errors in the upload flow) now `captureException(err, { context })`, skipping 5xx already captured upstream (`isCapturedApiError`).
- **User decisions:** email stays a person property; no internal-user filtering; no session replay; no `posthog-node` (Phase 3).

**Status:** merged as PR #16 and live. The Insights still need building in the PostHog UI.

### PostHog Phase 1: foundation (PR #15, merged 2026-11-24)

First phase of the PostHog user-behavior plan (Phase 2 — taxonomy, `score_id` rename, team scores/colors, dashboards — follows).

- **Client options** (`lib/analytics.ts`): `flushAt` 1 dev / 5 prod, `flushInterval` 5s (CONTEXT.md previously said the default was 30s; it's 10s), `preloadFeatureFlags: false`, `disableSurveys: true`, lifecycle events on, error autocapture for uncaught exceptions (native) + unhandled rejections, console capture off. `EXPO_PUBLIC_POSTHOG_DEBUG=true` → `posthog.debug(true)`.
- **Super props:** `platform`, `environment`, `app_version`, `commit`. `analytics.reset()` re-registers them because `reset()` wipes them. `vercel.json`'s build command now passes `EXPO_PUBLIC_VERCEL_ENV` / `EXPO_PUBLIC_COMMIT_SHA` from the Vercel system vars.
- **Identify fix** (`app/_layout.tsx` AuthGate): previously `identify` ran twice on every load (`getSession` + `INITIAL_SESSION`) and `signed_in` fired on every auth event that carried a session (INITIAL_SESSION, TOKEN_REFRESHED, USER_UPDATED…). Now there's one listener, identify runs once per app run per user with `$set { email, display_name }` + `$set_once { first_seen_at }`, and `signed_in { method, platform }` fires only when PostHog's distinct ID goes from anonymous to the user. **Decision:** we don't key it on Supabase's `SIGNED_IN` event, because supabase-js 2.106 also emits `SIGNED_IN` when it restores a stored session and on every web tab refocus, and the web magic-link `SIGNED_IN` can fire before the listener subscribes. `display_name` changes go to the person via `setPersonProperties`. `SIGNED_OUT` now also resets PostHog (covers expiry and other-tab sign-out).
- **Screens:** one `usePathname()` effect in `RootLayoutNav` → `history`, `profile`, `upload`, `score/[id]` (+ `score_id`). `auth` / `display_name_setup` fire on mount. The one-off detail-screen `screen()` call was removed.
- **Errors:** root `ErrorBoundary` `onError` → `captureException(error, { component_stack })`.
- **User decisions:** store email + display name on persons (yes); no internal-user filtering; session replay deferred; lifecycle defaults kept; the `scoreId` → `score_id` prop rename is Phase 2.

**Status:** merged as PR #15. tsc/lint clean, web bundle compiles, Non-Prod ingestion verified (`/flags` 200, test event 200).

### Delete confirmation feedback (PR #13, merged 2026-11-24)

**Problem:** confirming a delete gave no feedback, so users tapped Confirm again and sent duplicate DELETEs (seen in prod; the server already 404s the duplicate). Score Detail also closed the modal and navigated back regardless of outcome.

**Fix (both the History swipe-delete modal and the Score Detail modal):** shared hook `lib/use-delete-score.ts` (`useDeleteScore(source)`) holds the flow. A `useRef` re-entry guard stops double-taps; the Delete button shows a spinner + "Deleting…" and Cancel / overlay tap / Android back are disabled while the request runs; the modal stays open until it finishes. On success the modal closes and an app-level **"Score deleted" toast** shows. History removes the row from the `["/api/scores"]` cache right away (optimistic), then invalidates. Detail calls `router.back()`, and the toast is still visible on History. On failure the modal stays open with an inline error ("Couldn't delete — check your connection and try again."), the buttons re-enable, and History rolls back the optimistic removal. **A 404 counts as success** (already deleted). `apiRequest` now throws an `ApiError` with a `status` field; the message format (`"<status>: <body>"`) is unchanged. Analytics: `score_deleted` fires once per success (`already_deleted: true` on the 404 path); new `score_delete_failed` event `{ source, scoreId, error }`.

**Toast:** `contexts/ToastContext.tsx` (`ToastProvider` + `useToast().showToast(message, { type?: "success" | "error" })`) + `components/Toast.tsx`, mounted in `app/_layout.tsx` above the Stack so it survives navigation. Reanimated fade/slide, auto-dismiss after 2.5s, one at a time, bottom-anchored above the TabBar (60px + safe-area inset), theme colors, `pointerEvents: "none"`, `accessibilityRole="alert"` + live region (plus `announceForAccessibility` on iOS). On iOS it renders inside `react-native-screens`' `FullWindowOverlay` so it shows above native modals. No new dependency.

**Verified:** tsc 0 errors, lint 0 problems; web dev bundle compiles; local API DELETE on the same score returned 200 then 404. Not yet clicked through by hand — see the manual checklist in the PR/hand-off.

### Persist edited played date (PR #14, merged 2026-11-24)

**Bug (data loss):** `app/upload.tsx` auto-saves the score (`POST /api/scores`) right after a successful parse, then the result screen lets the user edit the played date. `saveDateEdit` only updated local state and fired `played_date_changed` — nothing reached the server and there was no route to update `played_date`, so **every edited played date was silently lost**.

**Fix:** new `PATCH /api/scores/:id/played-date` (`{ playedDate }`): 400 `Invalid playedDate` if missing/unparseable; stored normalized via `toISOString()` (column is TEXT holding ISO strings); ownership mirrors DELETE (fetch `user_id` → 404 missing, 403 not the uploader); update uses `.select()` without `.single()` and treats 0 rows as 404 (same race-safe pattern as the DELETE fix). Client: when `savedId` exists, `saveDateEdit` PATCHes the date — Save shows a spinner + "Saving…", both buttons and the overlay are disabled, and a `useRef` guard blocks re-entry (pattern mirrors the `feat/delete-feedback` delete hook). Success → update local state, close modal, invalidate `["/api/scores"]`. Failure → modal stays open with inline error "Couldn't save the date — check your connection and try again.", previous date kept, buttons re-enabled. If `savedId` is null (auto-save failed) the edit stays local-only as before. Analytics: `played_date_changed` now carries `{ location: "upload", score_id }`; new `played_date_change_failed { location, score_id, error }`. `score_id` (snake_case) is the agreed prop convention going forward.

**Verified (local Supabase):** PATCH → 200 and `GET /api/scores` shows the normalized ISO value; invalid/missing/non-string date → 400; unknown id (UUID and non-UUID) → 404; no token → 401; second local user PATCHing dev's score → 403 and the value is unchanged. tsc 0 errors, `expo lint` clean, web bundle compiles.

### Parse prompt: colors by panel, not position (PR #10, merged 2026-11-24)

**Bug:** the `/api/parse-score` prompt hard-coded player colors by panel position (blue top-left, yellow bottom-left, red top-right, purple bottom-right). The physical layout varies by ride vehicle — 3 of the 5 prod boards (Aug 25 2025, Sep 29 2025, Oct 27 2026) are yellow TL / blue BL / purple TR / red BR — so the model read the numbers right but swapped colors within a column. On those boards the top panel of each column has **white** digits, so color must come from the panel background/frame.

**Fix:** prompt moved to `server/parsePrompt.ts` (system prompt, user text, model, `buildParseRequest`, `extractParsedJson`, `checkParsedScore`) so offline validation can exercise the exact production request. Prompt now derives color only from each panel's background/digit color and says positions vary; each player gets a `position` field (traceability, stored in `players` JSONB; `Score.players[].position?` is optional). JSON mode (`response_format: json_object`) on, regex extraction kept as fallback. Post-parse sanity checks (4 players, colors exactly {blue,yellow,red,purple}; players + 3 objectives === teamScore) `console.warn` and add a `warning` string to the response — they never block the save. **Note:** a within-column color swap passes both sanity checks (same set of colors, same sum), so they can't catch this specific bug — only the prompt fix does.

**Validation (live OpenAI, 5 prod images, ground truth checked by eye + sum):** old prompt on Oct 27 → red/purple swapped in 3/3 runs (reproduces the bug). New prompt + `gpt-4o-mini` → colors 25/25 correct, but Aug 25's glare-washed "Rescue Spider-Man" 37,000 misread as 70,000/77,000/70,700 in 5/5 runs (the sum check flagged every one). New prompt + `gpt-4.1-mini` → 25/25 exact on every field; `gpt-4o` → 5/5 exact on Aug 25. **Switched production model to `gpt-4.1-mini`** — most accurate and cheapest per photo (~6k input tokens vs ~26k for 4o-mini, which bills images at a high token multiplier).

**Status:** shipped and verified in production (real re-uploads of the Oct 27 and Aug 25 boards parsed exactly). Prod rows Aug 25, Sep 29 and Oct 27 were corrected by hand.

### Post-deploy follow-ups (PR #11, merged 2026-11-24)

- **Blank player names:** the prompt schema said `"name": "<player name or identifier>"`; the board shows no names, so `gpt-4.1-mini` could return `""` and the UI (which falls back to `player.name`) rendered blank labels. Prompt now asks for the capitalized color name, and `normalizePlayerNames()` (in `server/parsePrompt.ts`, called in `/api/parse-score` before the sanity checks) fills any missing/blank name with the capitalized color. Re-validated live (gpt-4.1-mini, 3 runs x 5 boards): all fields exact, names returned as color names every time.
- **DELETE race:** `DELETE /api/scores/:id` no longer uses `.single()` on the delete step; 0 rows deleted returns 404 `Score not found` (no error log) instead of a 500 from PGRST116. Client-side delete UX followed in PR #13 (see Delete confirmation feedback).
- **Docs:** prod `SUPABASE_SERVICE_ROLE_KEY` is now a Supabase secret key (`sb_secret_…`) stored as a Vercel Secret; variable name kept for compatibility, code unchanged. Docs reworded accordingly. (The follow-on client-key swap and legacy-key disable are complete — see Recently Completed → Supabase API key migration.)

### Supabase API key migration (2026-11-24)

The prod Supabase project is fully off the legacy JWT API keys. **Why:** Vercel flagged the service-role key as a readable secret, and the legacy keys were also retiring at the end of 2026. **Approach (zero downtime):** (1) created a new **secret key** (`sb_secret_…`) and stored it as a Vercel **Secret** in `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview), then deployed (PR #11 docs); (2) created a dedicated **publishable key** (`sb_publishable_…`, named `vercel_publishable_key`) and set it in `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Production + Preview) as a normal, non-secret var — it is public by design and ships in the web bundle — then redeployed **without build cache** because `EXPO_PUBLIC_*` is baked in at build time; (3) only then **disabled the legacy `anon` + `service_role` JWT keys**. Variable names are kept for compatibility, so `lib/supabase.ts` and `server/supabase.ts` are unchanged.

**Verification:** the live bundle ships only the publishable key; the legacy anon key now returns 401 "Legacy API keys are disabled"; a real prod upload works end to end (client storage upload via the publishable key + user session, server via the secret key). Existing user sessions were unaffected. The legacy toggle is reversible in the Supabase dashboard (Settings → API Keys) if ever needed. The readable Development-only Vercel vars (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`) were deleted; local dev reads `.env`, which points at the local Supabase stack (demo keys from `supabase status -o env`, still legacy-style JWTs locally, which is fine). `.env.prod-reference` (gitignored) now holds the prod secret + publishable keys.

### Local Supabase dev workflow (PR #9, merged 2026-11-24)

Local dev now runs against a local Supabase stack (Supabase CLI 2.117.0 + Docker) instead of the prod project. Before, the local `.env` pointed at prod, so local testing wrote real prod data. New scripts: `npm run db:start` / `db:stop` / `db:reset` / `db:status` (`db:start` is not chained into `npm run dev` — cold start ~30s). Local endpoints: API `127.0.0.1:54321`, Postgres `54322`, Studio `54323`, Mailpit `54324` (magic-link inbox). `supabase/config.toml` sets invite-only auth (`enable_signup = false`, site_url `http://localhost:8081`, redirects `http://localhost:8081/**` + `scoreslinger://**`); `supabase/seed.sql` creates confirmed test user `dev@local.test` plus 2 fake scores. Prod env values moved to gitignored `.env.prod-reference` (deliberately not an Expo-recognised name, so `expo export` can't bake prod into a local build); `.env` holds local values.

**Schema drift fixed:** the schema now lives in `supabase/migrations/` (`20260101000000_scores_table.sql`, `20260101000001_storage_bucket_and_policies.sql`), mirroring live prod exactly. The old `01_scores_table.sql` / `02_storage_policies.sql` were removed — they would not have built a correct schema: `user_id text references auth.users(id)` (text→uuid FK fails; prod has no FK), `played_date timestamptz` (prod is `text`), missing `game_name default 'Unknown'`, and differing storage policy names. The bucket is now created in SQL. Prod baseline at the time: `public.scores` 5 rows, 33 storage objects in `scores` (more objects than rows → orphaned images from discarded uploads).

### App logo (PR #7, merged 2026-07-23)

New Score Slinger logo (teal "S"/arrow with hanging spider + red trajectory burst on dark navy) wired into every icon slot: app icon, browser favicon, splash, and Android adaptive icon. The source had a light artboard background around a rounded-dark-square; regenerated **full-bleed** with the light bg replaced by the logo's own navy (`#01051D`) so the OS rounded-mask renders cleanly. Master source kept at `assets/images/score-slinger.png`. **Note:** icons are baked at build time — verify on a native/EAS build, not the dev server.

### tsc + lint cleanup (PR #6, merged 2026-07-23)

Project now type-checks and lints spotless (0 tsc errors, 0 lint warnings — a first). Cleared the 3 tsc baseline errors (`TabBar` `href` cast, `analytics.ts` prop-type cast, new `types/exif-parser.d.ts` shim) and all lint warnings. **Also fixed a real native bug surfaced by the cleanup:** the native image-upload path used `expo-file-system`'s `readAsStringAsync`/`EncodingType`, which SDK 56 moved to the `/legacy` subpath — switched to `await import("expo-file-system/legacy")`. Web was never affected (it uses a separate `fetch`/`blob` path), so this only manifests on native — **verify on a device build.**

### Analytics event coverage (PR #4, merged 2026-07-20)

Expanded PostHog from a handful of events to comprehensive coverage of every user action (~40 events, `snake_case noun_verb`, consistent props). Mobile gestures (swipe-to-delete `card_swiped_open`, pull-to-refresh `history_pull_refreshed`) are tagged with `platform`. All flows through the null-safe `lib/analytics.ts`. Full catalog documented in **CONTEXT.md → External Integrations → PostHog**. Also set up a separate **Non-Prod PostHog project** for local/preview so dev events don't pollute production.

### Dependency refresh (PR #3, merged 2026-07-20)

Ten commits, one revertable unit each: Expo SDK 54 → 56 (React 19.2, RN 0.85), `@hono/node-server` 1 → 2, `zod` 3 → 4, patch/minor sweep, and react-compiler GA. All `npm audit` high-severity findings cleared (25 → 13, remaining are the upstream `xcode → uuid` dev-tooling chain — dev/build-time only). Migrated swipe-to-delete off `PanResponder` onto `react-native-gesture-handler` for React Compiler compatibility. Deleted dead files (`scripts/build.js`, `server/templates/landing-page.html`, orphaned `shared/models/chat.ts`). Added `npm run dev` (concurrently); moved local server port to **5055** (AirPlay binds 5000). Un-ignored + refreshed the project docs.

**Deferred (intentionally):** ESLint 9 → 10 and TypeScript 5 → 6 wait on `eslint-config-expo` / Metro typings catching up.

### UI redesign (PR #2, merged)

Replaced the monolithic `app/index.tsx` (~1800 lines, conditional renders) with expo-router tab + modal architecture: `app/_layout.tsx` (AuthGate + DisplayNameSetup + Stack), `(tabs)/index.tsx` (History), `(tabs)/profile.tsx` (Profile), `upload.tsx` and `score/[id].tsx` (modals), and a custom `components/TabBar.tsx` with centered FAB. New design tokens in `constants/colors.ts`.

### PostHog analytics

- `posthog-react-native` + `lib/analytics.ts` wrapper (no-op if key not set); integrated across app and AuthScreen. Local/preview should use the **Non-Prod** PostHog project.

### Score detail deep-link URLs

- Shareable/linkable URLs for individual score detail views.

### Documentation & SQL setup files

- `supabase/` folder with SQL setup scripts and README

---

## Decisions Made

### Local Supabase over a cloud non-prod project; migrations as schema source of truth (2026-11-24)

The Supabase org ("Sam's Org") is on the Pro plan, where every project bills compute (~$10/mo); a paid non-prod project was declined. A local stack is $0 and fully isolated, and mirrors the PostHog Non-Prod split in spirit. `supabase/migrations/` is now the schema source of truth. New migrations: `supabase migration new <name>`, test with `npm run db:reset`, then apply to prod via the dashboard SQL Editor (or Supabase MCP `apply_migration`) — prod's existing schema predates the migrations folder. Optional drift check later: `supabase link --project-ref <ref> && supabase db diff --linked`. Tradeoff: Vercel previews still hit the prod Supabase project.

### Navigation: tab bar \+ modals (2026-03-31)

Replaced conditional-render screen pattern with expo-router tabs \+ Stack modals.

- History is the default/home tab  
- Profile is the second tab  
- Camera FAB (centered in tab bar, overlapping 28px) opens action sheet → navigates to `/upload` with image URI params  
- Score detail navigates to `/score/[id]` as a modal  
- Both modals use `presentation: "modal"` in the Stack

### Upload flow: auto-save on parse success (2026-03-31)

On the upload modal, the score is saved to the DB immediately after successful AI parsing (no explicit "Save" button). The user can discard (which deletes the saved record) or tap "Done" to keep it. This simplifies the flow — no unsaved state hanging around.

### Auth gate in `_layout.tsx` (2026-03-31)

Auth session management (`AuthGate` component), magic link deep link handling, and display name setup all live in `app/_layout.tsx`. The tab routes are always rendered authenticated — the gate is above the Stack navigator. This is cleaner than gating inside each screen.

### Color tokens updated (2026-03-31)

- Background: `#0f0f0f` (was `#0A0E1A`)  
- Surface: `#1a1a1a` (was `#131829`)  
- Player colors updated to v0 spec: Blue `#3b82f6`, Yellow `#eab308`, Red `#ef4444`, Purple `#a855f7`  
- Teal accent (`#00E5CC`) kept — user preferred it over indigo

### Hono over Express

Switched backend from Express to Hono. Hono runs natively on Vercel serverless, first-class TypeScript, significantly lighter.

### Supabase JS client over Drizzle ORM

Dropped Drizzle after WSL/Windows toolchain conflicts. Supabase JS client handles all DB queries directly.

### Private Storage bucket \+ signed URLs

Images stored as paths, displayed via 60s signed URLs from `GET /api/scores/:id/image-url`.

### Invite-only auth via `shouldCreateUser: false`

Unknown emails silently rejected — no rate limit abuse, no email leak.

### PKCE flow for magic link

Magic link redirects with `code=` param; SDK exchanges for session automatically (web) or manually (native).

### Display name in Supabase user metadata

Saved to AsyncStorage (fast) \+ `supabase.auth.updateUser` (cross-device sync).

### EXPO\_PUBLIC\_DOMAIN must match browsing domain (no protocol)

`getApiUrl()` prepends `https://`; the value must be bare domain.

---

## Known Gotchas

### EXPO\_PUBLIC\_\* vars require a full rebuild (no cache)

Baked into the static Expo web export at build time.

### Double-protocol bug (`https://https/...`)

If `EXPO_PUBLIC_DOMAIN` is set with `https://` prefix, `getApiUrl()` produces a broken URL.

### www vs non-www CORS

Both must be in `ALLOWED_ORIGINS`, or `EXPO_PUBLIC_DOMAIN` must match exactly.

### Metro bundler first-run is slow on WSL

3–5 minutes on first `npm run expo:dev`. Normal; subsequent runs use cache.

### `localhost:5055` returns 404 at root

Expected — server only handles `/api/*`. (Port is 5055, not 5000 — macOS AirPlay Receiver binds 5000.)

### FAB position on web

The `position: "absolute"` FAB with `left: "50%"` \+ `marginLeft` centering works on native but may need adjustment on web depending on layout.

---

## Blocked / Open Questions

- Should `slingers.app` redirect to `www.slingers.app` in Vercel Domains? Currently both work but API calls only go to `www.slingers.app`.  
- Future: per-user score filtering via RLS on `scores` table?

---

## Next Steps

Backlog, no active work:

1. **Native build verification** — the app icons/splash (PR #7) and the `expo-file-system/legacy` native-upload fix (PR #6) are both baked at build time and unverified on device. Confirm on a native/EAS build (or `expo run:ios`/`run:android`): home-screen icon, splash, and a native image upload.  
2. **Vercel previews still point at the prod Supabase project** — local can't serve them, so preview testing can still write prod data. Options later: a cloud non-prod project, or Supabase Branching.  
3. **Device testing against local Supabase** — iOS Simulator reaches `127.0.0.1`; Android emulator needs `10.0.2.2:54321`; a physical phone needs the Mac's LAN IP in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_DOMAIN`.  
4. **Orphaned storage objects in prod** — 33 objects in bucket `scores` vs 5 rows; discarded uploads leave images behind. Clean up, and consider fixing the discard path.  
5. **Supabase CLI v3 upgrade** (currently 2.117.0).  
6. **Observability / error tracking:** Sentry Phase 1 (server) is live; Phases 2–3 (client SDK + PostHog error-capture split, source maps) are on `feat/sentry-client`; Phase 4 (optional on-error replay) needs a user decision (`docs/SENTRY_PLAN.md`).  
7. **Deferred dep majors** — ESLint 9 → 10, TypeScript 5 → 6 (revisit once `eslint-config-expo` / Metro typings support them).  
8. Future: profile photo support (avatar circle already in place — swap initials for `<Image>`)  
9. Future: email/password auth as second method in `components/AuthScreen.tsx`  
10. Future: per-user score filtering via RLS on `scores` table
11. ~~**Delete UX feedback**~~ — **done** (branch `feat/delete-feedback`, 2026-11-24; see Recently Completed → Delete confirmation feedback). Still needs a manual click-through on web + a native device (toast above iOS modals uses `FullWindowOverlay`).  

